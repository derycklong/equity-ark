"""Portfolio store backed by SQLite for persistence.

On startup: loads from SQLite if data exists, otherwise from CSV.
On CSV reload: wipes SQLite and rebuilds all data.
FX historical rates are cached permanently in SQLite.
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional

from .db import Database
from .services.csv_parser import RawTransaction, load_csv, parse_csv_text
from .services.market_data import MarketDataService
from .services.portfolio import (
    build_currency_breakdown,
    build_holdings_and_roundtrips,
    build_portfolio_summary,
    compute_profile,
    compute_twr,
    compute_xirr,
    summarize_holdings,
)
from .services.dividends import (
    aggregate_dividends,
    dividends_to_holdings_map,
    estimate_received_dividends,
    has_dividend_history,
)
from .services.fx import FxService

logger = logging.getLogger(__name__)


class PortfolioStore:
    def __init__(self, db: Database, user_id: str, market_data: MarketDataService | None = None):
        self.user_id = user_id
        self.db = db  # shared Database instance

        self.transactions: List[RawTransaction] = []
        self.open_lots: Dict[str, list] = {}
        self.roundtrips: List = []
        self.meta: Dict[str, dict] = {}
        self.holdings: List[dict] = []
        self.holdings_by_symbol: Dict[str, dict] = {}
        self.realized_by_symbol: Dict[str, float] = {}
        self.profile: dict = {}
        self.dividend_events: List[dict] = []
        self.dividend_summary: dict = {}
        self.dividends_by_symbol: Dict[str, float] = {}
        self.last_load_errors: List[str] = []
        self._lock = threading.RLock()
        self._networth_cache: Dict[str, tuple] = {}

        self.market_data = market_data or MarketDataService(ttl_seconds=600)
        self.fx = FxService(ttl_seconds=3600, db=self.db)
        self._prices: Dict[str, dict] = {}
        try:
            self._prices = self.db.load_all_price_caches()
        except Exception:
            pass

        self._load_or_rebuild()

    # ----- load -----

    def _load_or_rebuild(self) -> None:
        """Try to load from SQLite; fall back to CSV if SQLite is empty."""
        db_txs = self.db.load_transactions(self.user_id)
        if db_txs:
            logger.info("Loading portfolio from SQLite (%d transactions, user=%s)", len(db_txs), self.user_id)
            self._load_from_db(db_txs)
        else:
            logger.info("New user %s — empty portfolio", self.user_id)
            self.db.clear_dashboard_cache(self.user_id)
            self.db.clear_dividend_events(self.user_id)
            self.clear_advice_cache()

    def _load_from_db(self, db_txs: List[dict]) -> None:
        """Rebuild all in-memory structures from SQLite rows."""
        from .services.csv_parser import RawTransaction

        self.transactions = []
        for idx, t in enumerate(db_txs):
            raw = RawTransaction(
                date=date.fromisoformat(t["date"]),
                side=t["side"],
                symbol=t["symbol"],
                exchange=t["exchange"],
                quantity=t["quantity"],
                price=t["price"],
                gross_amount=t["gross_amount"],
                net_amount=t.get("net_amount", t["gross_amount"]),
                fees=t["fees"],
                currency=t["currency"],
                label=t.get("label", ""),
                note=t.get("note", ""),
                id=t.get("id") or idx + 1,  # Use stored id or fallback to position
                name=t.get("name", ""),
            )
            self.transactions.append(raw)

        open_lots, roundtrips, meta = build_holdings_and_roundtrips(self.transactions)
        self.open_lots = open_lots
        self.roundtrips = roundtrips
        self.meta = meta

        realized_by_symbol: Dict[str, float] = {}
        for r in roundtrips:
            realized_by_symbol[r.symbol] = realized_by_symbol.get(r.symbol, 0.0) + r.pnl
        self.realized_by_symbol = realized_by_symbol

        self.holdings = summarize_holdings(open_lots, meta, realized_by_symbol)
        self.holdings_by_symbol = {h["symbol"]: h for h in self.holdings}

        from .services.dividends import DIVIDEND_WITHHOLDING
        self.dividend_events = self.db.load_dividend_events(self.user_id)
        # The stored total_received is already the NET amount (after withholding).
        # We do NOT re-apply withholding on load — that caused compound decay on
        # every restart. If the rate needs to change, gross up using the stored
        # withholding_rate and re-apply the new rate.
        def _market_of(e: dict) -> str:
            sym = e.get("symbol", "").upper()
            h = self.holdings_by_symbol.get(sym)
            if h and h.get("market"):
                return h["market"]
            ysym = e.get("yahoo_symbol", "")
            if ysym.endswith(".SI"): return "sg"
            if ysym.endswith(".HK"): return "hk"
            if ysym.endswith(".L"): return "uk"
            if ysym.endswith((".SS", ".SZ")): return "cn"
            if ysym.startswith("SGX") and not ysym.endswith(".SI"):
                return "fund"  # SGX ISIN tickers are funds
            return "us"
        for e in self.dividend_events:
            stored_rate = e.get("withholding_rate", 0.0)
            new_rate = DIVIDEND_WITHHOLDING.get(_market_of(e), 0.0)
            if abs(new_rate - stored_rate) > 1e-9 and stored_rate:
                # Rates differ — gross up using the stored rate, then re-apply
                gross = e["total_received"] / (1 - stored_rate)
                e["total_received"] = round(gross * (1 - new_rate), 4)
                e["withholding_rate"] = new_rate
            else:
                # Rates match (or no rate stored) — stored value is authoritative
                e["withholding_rate"] = stored_rate
        self.dividend_summary = aggregate_dividends(self.dividend_events, self.holdings)
        self.dividends_by_symbol = dividends_to_holdings_map(self.dividend_events)

        # One-time backfill: detect legacy dividend rows that were compound-
        # decayed by the old double-withholding bug. Any event for a market
        # that SHOULD have withholding (US/CN) but stores 0.0 needs a re-fetch.
        # We wipe all events for the user and re-fetch from yfinance in the
        # background — the data is unrecoverable otherwise.
        needs_backfill = self._needs_dividend_backfill()
        if needs_backfill:
            logger.warning(
                "Detected legacy dividend data (withholding_rate=0 for %d US/CN events); "
                "scheduling re-fetch in background", needs_backfill
            )
            threading.Thread(target=self._backfill_dividends_async, daemon=True).start()

        # Re-fetch dividends for holding symbols that have no events yet,
        # or whose yfinance data is newer than what's in the DB.
        # Skip symbols in the negative cache (confirmed to have no dividends
        # within the last 7 days) — this avoids re-hitting yfinance for
        # delisted SPACs and non-dividend tickers.
        # Also skip the staleness check for symbols whose latest DB event is
        # within the last 7 days — the daily scheduler picks up new dividends
        # within 24h, so this window keeps the initial load fast without
        # missing any new declarations for more than a week.
        from datetime import date as _date, timedelta as _td
        NO_DIV_TTL = 7 * 86400  # 7 days
        no_div_yf = self.db.get_no_div_symbols(NO_DIV_TTL)
        freshness_cutoff = (_date.today() - _td(days=7)).isoformat()

        holding_symbols = {h["symbol"].upper() for h in self.holdings
                           if h.get("market") not in ("sg_bond", "cash")}
        existing_div_symbols = {e["symbol"].upper() for e in self.dividend_events}

        # Build a map: symbol -> latest ex_date in DB
        latest_db_ex: Dict[str, str] = {}
        for e in self.dividend_events:
            sym = e["symbol"].upper()
            if sym not in latest_db_ex or e["ex_date"] > latest_db_ex[sym]:
                latest_db_ex[sym] = e["ex_date"]

        # Determine which symbols need fetching: missing entirely or stale
        need_fetch: set = set()
        for sym in holding_symbols:
            if sym not in existing_div_symbols:
                need_fetch.add(sym)
                continue
            # Skip staleness check if the latest DB event is fresh
            if latest_db_ex.get(sym, "") >= freshness_cutoff:
                continue
            # Check if yfinance has a newer dividend by fetching the series
            try:
                # Find a transaction for this symbol to resolve yahoo_symbol
                res = None
                for t in self.transactions:
                    if t.symbol.upper() == sym:
                        res = t.resolution()
                        break
                if res and res.yahoo_symbol:
                    if res.yahoo_symbol in no_div_yf:
                        continue  # confirmed no dividends, skip
                    yf_divs = self.market_data.get_dividends(res.yahoo_symbol)
                    if yf_divs is None or yf_divs.empty:
                        self.db.mark_no_dividends(res.yahoo_symbol)
                    else:
                        # Convert index to naive dates for comparison
                        try:
                            yf_divs.index = yf_divs.index.tz_convert(None)
                        except Exception:
                            try:
                                yf_divs.index = yf_divs.index.tz_localize(None)
                            except Exception:
                                pass
                        latest_yf = max(d.date().isoformat() for d in yf_divs.index)
                        if latest_yf > latest_db_ex.get(sym, ""):
                            need_fetch.add(sym)
                        self.db.clear_no_dividend_mark(res.yahoo_symbol)
            except Exception as e:
                logger.debug("staleness check failed for %s: %s", sym, e)

        if need_fetch:
            # Remove old events for symbols being re-fetched
            self.dividend_events = [
                e for e in self.dividend_events
                if e["symbol"].upper() not in need_fetch
            ]
            seen_syms: set = set()
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym not in need_fetch or sym in seen_syms:
                    continue
                seen_syms.add(sym)
                try:
                    res = t.resolution()
                    self.dividend_events.extend(estimate_received_dividends(
                        self.transactions, sym, res.market, t.currency,
                        self.market_data, yahoo_symbol=res.yahoo_symbol,
                    ))
                except Exception as e:
                    logger.debug("dividend fetch failed for %s: %s", sym, e)
            self.dividend_summary = aggregate_dividends(self.dividend_events, self.holdings)
            self.dividends_by_symbol = dividends_to_holdings_map(self.dividend_events)
            self._persist_to_db()
            # Invalidate dashboard cache so it reflects updated dividends.
            # NOTE: don't clear the advice cache here — the advice report is
            # a high-level structural analysis that doesn't change when a
            # single new dividend is declared, and clearing it on every
            # daily refresh would defeat the whole point of caching.
            try:
                self.db.clear_dashboard_cache(self.user_id)
            except Exception:
                pass

        self.profile = compute_profile(
            self.transactions, self.roundtrips, self.open_lots, self.dividends_by_symbol,
            base_currency="SGD", fx_service=self.fx,
        )

    def _persist_to_db(self) -> None:
        """Save all computed data to SQLite, then sync IDs back."""
        try:
            self.db.save_transactions(self.user_id, self.get_transactions())
            self.db.save_open_lots(self.user_id, self.open_lots)
            self.db.save_roundtrips(self.user_id, self.get_roundtrips())
            self.db.save_dividend_events(self.user_id, self.dividend_events)
            self._sync_ids_from_db()
            # Any data change invalidates the cached advice report so
            # the next view reflects the new holdings / P&L.
            try:
                self.db.clear_dashboard_cache(self.user_id)
                self.clear_advice_cache()
            except Exception:
                pass
            logger.info("Persisted portfolio to SQLite")
        except Exception as e:
            logger.error("Failed to persist to SQLite: %s", e)

    def _invalidate_networth_cache(self) -> None:
        """Clear in-memory net worth history cache for this user."""
        self._networth_cache = {k: v for k, v in self._networth_cache.items() if not k.startswith(f"{self.user_id}:")}

    def _sync_ids_from_db(self) -> None:
        """After persist, read back auto-assigned IDs from SQLite and
        sync them into the in-memory RawTransaction objects.

        Persists in get_transactions() order (date DESC, id DESC).
        Reads back in the same order and maps positionally.
        """
        try:
            db_txs = self.db.load_transactions(self.user_id)
        except Exception:
            return
        # Build a lookup keyed on content fields to handle ordering differences
        lookup: Dict[tuple, int] = {}
        for t in db_txs:
            key = (
                t["date"],
                t["symbol"].upper(),
                t["side"],
                round(t["quantity"], 6),
                round(t["price"], 6),
            )
            lookup[key] = t["id"]
        # Also update names from DB
        db_name_map: Dict[str, str] = {}
        for t in db_txs:
            sym = t["symbol"].upper()
            nm = t.get("name", "")
            if nm and sym not in db_name_map:
                db_name_map[sym] = nm
        for t in self.transactions:
            key = (
                t.date.isoformat(),
                t.symbol.upper(),
                t.side,
                round(t.quantity, 6),
                round(t.price, 6),
            )
            t.id = lookup.pop(key, getattr(t, "id", None))
            # Sync name from DB if the in-memory object has none
            if not getattr(t, "name", "") and t.symbol.upper() in db_name_map:
                t.name = db_name_map[t.symbol.upper()]

    def load_csv_file(self, path: str | Path) -> dict:
        with self._lock:
            txs, errors = load_csv(path)
            self.last_load_errors = errors
            self.transactions = txs
            self._rebuild()
            return {"imported": len(txs), "skipped": len(errors), "errors": errors[:10]}

    def load_csv_text(self, text: str) -> dict:
        with self._lock:
            txs, errors = parse_csv_text(text)
            self.last_load_errors = errors
            self.transactions = txs
            self._rebuild()
            return {"imported": len(txs), "skipped": len(errors), "errors": errors[:10]}

    def _rebuild(self) -> None:
        open_lots, roundtrips, meta = build_holdings_and_roundtrips(self.transactions)
        self.open_lots = open_lots
        self.roundtrips = roundtrips
        self.meta = meta

        realized_by_symbol: Dict[str, float] = {}
        for r in roundtrips:
            realized_by_symbol[r.symbol] = realized_by_symbol.get(r.symbol, 0.0) + r.pnl
        self.realized_by_symbol = realized_by_symbol

        self.holdings = summarize_holdings(open_lots, meta, realized_by_symbol)
        self.holdings_by_symbol = {h["symbol"]: h for h in self.holdings}

        events: List[dict] = []
        seen: Dict[str, dict] = {}
        for t in self.transactions:
            sym = t.symbol.upper()
            if sym in seen:
                continue
            seen[sym] = {
                "market": t.resolution().market,
                "currency": t.currency,
                "yahoo_symbol": t.resolution().yahoo_symbol,
            }
        for sym, info in seen.items():
            try:
                events.extend(estimate_received_dividends(
                    self.transactions, sym, info["market"], info["currency"],
                    self.market_data, yahoo_symbol=info["yahoo_symbol"],
                ))
            except Exception as e:
                logger.debug("dividend fetch failed for %s: %s", sym, e)
        self.dividend_events = events
        self.dividend_summary = aggregate_dividends(events, self.holdings)
        self.dividends_by_symbol = dividends_to_holdings_map(events)

        self.profile = compute_profile(
            self.transactions, self.roundtrips, self.open_lots, self.dividends_by_symbol,
            base_currency="SGD", fx_service=self.fx,
        )

        self._persist_to_db()

    def add_transaction(self, tx_input: dict) -> dict:
        """Add a single transaction, rebuild all derived data, persist to SQLite.

        Args:
            tx_input: dict with keys: date, side, symbol, exchange, quantity,
                      price, currency, fees, label, note

        Returns:
            dict with the added transaction and counts.
        """
        with self._lock:
            from .services.csv_parser import RawTransaction

            date_str = tx_input["date"]
            if isinstance(date_str, str):
                date_obj = date.fromisoformat(date_str)
            else:
                date_obj = date_str

            quantity = float(tx_input["quantity"])
            price = float(tx_input["price"])
            fees = float(tx_input.get("fees", 0.0))
            gross = quantity * price
            net = gross - fees if tx_input["side"] == "buy" else gross + fees

            # Fetch the company name (best-effort, does not block)
            name = self._fetch_name(
                tx_input["symbol"].upper(),
                tx_input.get("exchange", "USX"),
            )

            # New id = max(existing ids) + 1 (default 0 when no transactions)
            existing_ids = [t.id or 0 for t in self.transactions]
            new_id = (max(existing_ids) if existing_ids else 0) + 1

            raw = RawTransaction(
                date=date_obj,
                side=tx_input["side"],
                symbol=tx_input["symbol"].upper(),
                exchange=tx_input.get("exchange", "USX"),
                quantity=quantity,
                price=price,
                gross_amount=gross,
                net_amount=net,
                fees=fees,
                currency=tx_input.get("currency", "USD"),
                label=tx_input.get("label", ""),
                note=tx_input.get("note", ""),
                id=new_id,
                name=name,
            )
            self.transactions.append(raw)
            self._rebuild_from_transactions(refetch_symbols={raw.symbol.upper()})

            return {
                "added": raw.symbol,
                "id": new_id,
                "transactions": len(self.transactions),
                "holdings": len(self.holdings),
                "roundtrips": len(self.roundtrips),
            }

    def _fetch_name(self, symbol: str, exchange: str) -> str:
        """Best-effort: fetch the company name for a symbol via yfinance."""
        from .services.csv_parser import resolve_symbol
        try:
            res = resolve_symbol(symbol, exchange)
            q = self.market_data.get_quote(
                symbol=symbol,
                yahoo_symbol=res.yahoo_symbol,
                market=res.market,
                currency="",
            )
            return q.name or ""
        except Exception:
            return ""

    def update_transaction(self, tx_id: int, tx_input: dict) -> dict:
        """Update an existing transaction by ID, rebuild derived data."""
        with self._lock:
            from .services.csv_parser import RawTransaction

            target = None
            for t in self.transactions:
                if t.id == tx_id:
                    target = t
                    break
            if target is None:
                raise ValueError(f"Transaction {tx_id} not found")

            date_obj = date.fromisoformat(tx_input["date"]) if isinstance(tx_input["date"], str) else tx_input["date"]
            quantity = float(tx_input["quantity"])
            price = float(tx_input["price"])
            fees = float(tx_input.get("fees", 0.0))
            gross = quantity * price
            net = gross - fees if tx_input["side"] == "buy" else gross + fees

            new_symbol = tx_input["symbol"].upper()
            # Refresh name if symbol changed or no name present
            if new_symbol != target.symbol.upper() or not getattr(target, "name", ""):
                name = self._fetch_name(new_symbol, tx_input.get("exchange", target.exchange))
            else:
                name = target.name

            target.date = date_obj
            target.side = tx_input["side"]
            target.symbol = new_symbol
            target.exchange = tx_input.get("exchange", target.exchange)
            target.quantity = quantity
            target.price = price
            target.gross_amount = gross
            target.net_amount = net
            target.fees = fees
            target.currency = tx_input.get("currency", target.currency)
            target.label = tx_input.get("label", "")
            target.note = tx_input.get("note", "")
            target.name = name

            self._rebuild_from_transactions(refetch_symbols={target.symbol.upper()})

            return {
                "updated": tx_id,
                "symbol": target.symbol,
                "transactions": len(self.transactions),
                "holdings": len(self.holdings),
                "roundtrips": len(self.roundtrips),
            }

    def delete_transaction(self, tx_id: int) -> dict:
        """Delete a single transaction by ID, rebuild derived data."""
        with self._lock:
            before = len(self.transactions)
            deleted_tx = None
            for t in self.transactions:
                if t.id == tx_id:
                    deleted_tx = t
                    break
            self.transactions = [t for t in self.transactions if t.id != tx_id]
            deleted = before - len(self.transactions)
            if deleted == 0:
                raise ValueError(f"Transaction {tx_id} not found")
            refetch = {deleted_tx.symbol.upper()} if deleted_tx else None
            self._rebuild_from_transactions(refetch_symbols=refetch)
            return {
                "deleted": deleted,
                "id": tx_id,
                "transactions": len(self.transactions),
                "holdings": len(self.holdings),
                "roundtrips": len(self.roundtrips),
            }

    def delete_transactions_by_symbol(self, symbol: str) -> dict:
        """Delete all transactions for a symbol. Rebuilds all derived data."""
        with self._lock:
            before = len(self.transactions)
            self.transactions = [t for t in self.transactions if t.symbol.upper() != symbol.upper()]
            deleted = before - len(self.transactions)
            self._rebuild_from_transactions(refetch_symbols={symbol.upper()})
            return {
                "deleted": deleted,
                "symbol": symbol,
                "transactions": len(self.transactions),
                "holdings": len(self.holdings),
                "roundtrips": len(self.roundtrips),
            }

    def delete_transactions_by_ids(self, tx_ids: list[int]) -> dict:
        """Delete multiple transactions by ID. Rebuilds all derived data once."""
        with self._lock:
            id_set = set(tx_ids)
            before = len(self.transactions)
            self.transactions = [t for t in self.transactions if (t.id or 0) not in id_set]
            deleted = before - len(self.transactions)
            self._rebuild_from_transactions()
            return {
                "deleted": deleted,
                "ids": list(id_set),
                "transactions": len(self.transactions),
                "holdings": len(self.holdings),
                "roundtrips": len(self.roundtrips),
            }

    def _rebuild_from_transactions(self, refetch_dividends: bool = False,
                                     refetch_symbols: Optional[set] = None) -> None:
        """Common rebuild logic shared by add and delete.
        
        Args:
            refetch_dividends: If True, re-fetch dividend estimates from yfinance
                for ALL symbols. Default False — only fetches for symbols that
                have no dividend events yet (newly added tickers).
            refetch_symbols: If set, re-fetch dividends for these specific symbols
                even if they already have events (used when transactions change).
        """
        import time as _t
        t0 = _t.time()

        open_lots, roundtrips, meta = build_holdings_and_roundtrips(self.transactions)
        self.open_lots = open_lots
        self.roundtrips = roundtrips
        self.meta = meta
        _rebuild_t = _t.time()

        realized_by_symbol: Dict[str, float] = {}
        for r in roundtrips:
            realized_by_symbol[r.symbol] = realized_by_symbol.get(r.symbol, 0.0) + r.pnl
        self.realized_by_symbol = realized_by_symbol

        # All-time purchase stats per symbol (all BUY transactions)
        self.holdings = summarize_holdings(open_lots, meta, realized_by_symbol)
        self.holdings_by_symbol = {h["symbol"]: h for h in self.holdings}
        holdings_t = _t.time()

        # Determine which symbols need dividend fetching
        existing_div_symbols = {e["symbol"].upper() for e in self.dividend_events}
        all_symbols = {t.symbol.upper() for t in self.transactions}
        if refetch_dividends:
            need_fetch = all_symbols
        else:
            # Fetch for new symbols + explicitly requested symbols
            need_fetch = (all_symbols - existing_div_symbols) | (refetch_symbols or set())

        # Prune orphaned dividend events for symbols no longer in any transaction
        self.dividend_events = [
            e for e in self.dividend_events
            if e["symbol"].upper() in all_symbols
        ]

        if need_fetch:
            new_events: List[dict] = []
            # Keep existing events for symbols we're not re-fetching
            if not refetch_dividends:
                new_events = [e for e in self.dividend_events if e["symbol"].upper() not in need_fetch]
            seen: Dict[str, dict] = {}
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym not in need_fetch or sym in seen:
                    continue
                seen[sym] = {
                    "market": t.resolution().market,
                    "currency": t.currency,
                    "yahoo_symbol": t.resolution().yahoo_symbol,
                }
            for sym, info in seen.items():
                try:
                    new_events.extend(estimate_received_dividends(
                        self.transactions, sym, info["market"], info["currency"],
                        self.market_data, yahoo_symbol=info["yahoo_symbol"],
                    ))
                except Exception as e:
                    logger.debug("dividend fetch failed for %s: %s", sym, e)
            self.dividend_events = new_events

        self.dividend_summary = aggregate_dividends(self.dividend_events, self.holdings)
        self.dividends_by_symbol = dividends_to_holdings_map(self.dividend_events)

        self.profile = compute_profile(
            self.transactions, self.roundtrips, self.open_lots, self.dividends_by_symbol,
            base_currency="SGD", fx_service=self.fx,
        )

        self._persist_to_db()
        logger.info("_rebuild: fifo=%.2fs holdings=%.2fs total=%.2fs",
                     _rebuild_t - t0, holdings_t - _rebuild_t, _t.time() - t0)

    # ----- live prices -----

    def _needs_dividend_backfill(self) -> int:
        """Return the number of legacy dividend events that need re-fetching.

        Legacy events are rows that have withholding_rate=0 but whose resolved
        market SHOULD have non-zero withholding (US/CN). These were compound-
        decayed by the old double-withholding bug and cannot be recovered
        from the stored values alone.
        """
        from .services.dividends import DIVIDEND_WITHHOLDING
        count = 0
        for e in self.dividend_events:
            stored_rate = e.get("withholding_rate", 0.0)
            if stored_rate:
                continue
            sym = e.get("symbol", "").upper()
            h = self.holdings_by_symbol.get(sym)
            market = (h or {}).get("market") or ""
            if not market:
                ysym = e.get("yahoo_symbol", "")
                if ysym.endswith(".SI"): market = "sg"
                elif ysym.endswith(".HK"): market = "hk"
                elif ysym.endswith(".L"): market = "uk"
                elif ysym.endswith((".SS", ".SZ")): market = "cn"
                elif ysym.startswith("SGX"): market = "fund"
                else: market = "us"
            if DIVIDEND_WITHHOLDING.get(market, 0.0) > 0:
                count += 1
        return count

    def _backfill_dividends_async(self) -> None:
        """Wipe all dividend events for this user and re-fetch from yfinance.

        Runs in a background thread. The data was compound-decayed by the old
        bug and is unrecoverable, so we re-fetch cleanly.
        """
        try:
            with self._lock:
                logger.info("Backfilling dividends for user %s (wiping & re-fetching)", self.user_id)
                self.db.clear_dividend_events(self.user_id)
                self.dividend_events = []
                # Re-fetch for every symbol that has transactions.
                # Skip symbols in the negative cache (no dividends ever paid).
                no_div_yf = self.db.get_no_div_symbols(7 * 86400)
                seen: Dict[str, dict] = {}
                for t in self.transactions:
                    sym = t.symbol.upper()
                    if sym in seen:
                        continue
                    res = t.resolution()
                    if not res or not res.yahoo_symbol:
                        continue
                    if res.yahoo_symbol in no_div_yf:
                        continue
                    seen[sym] = {
                        "market": res.market,
                        "currency": t.currency,
                        "yahoo_symbol": res.yahoo_symbol,
                    }
                for sym, info in seen.items():
                    try:
                        fetched = estimate_received_dividends(
                            self.transactions, sym, info["market"], info["currency"],
                            self.market_data, yahoo_symbol=info["yahoo_symbol"],
                        )
                        # Only mark "no dividends" if yfinance itself has
                        # no history — not if the user simply never held at
                        # an ex-date.
                        if has_dividend_history(info["market"], self.market_data, info["yahoo_symbol"]):
                            self.db.clear_no_dividend_mark(info["yahoo_symbol"])
                        else:
                            self.db.mark_no_dividends(info["yahoo_symbol"])
                        self.dividend_events.extend(fetched)
                    except Exception as e:
                        logger.debug("dividend backfill fetch failed for %s: %s", sym, e)
                self.dividend_summary = aggregate_dividends(self.dividend_events, self.holdings)
                self.dividends_by_symbol = dividends_to_holdings_map(self.dividend_events)
                self.profile = compute_profile(
                    self.transactions, self.roundtrips, self.open_lots,
                    self.dividends_by_symbol, base_currency="SGD", fx_service=self.fx,
                )
                self.db.save_dividend_events(self.user_id, self.dividend_events)
                # Clear dashboard cache but keep advice cache (see comment above)
                try:
                    self.db.clear_dashboard_cache(self.user_id)
                except Exception:
                    pass
                logger.info("Dividend backfill complete: %d events for user %s",
                            len(self.dividend_events), self.user_id)
        except Exception as e:
            logger.error("Dividend backfill failed for user %s: %s", self.user_id, e)

    def refresh_dividends(self, force: bool = False) -> dict:
        """Re-fetch all dividend events from yfinance for the current holdings.

        Use this when a new dividend has been declared and you want to pick it
        up without restarting the server. Returns counts of refreshed symbols.

        Symbols whose yfinance lookup returned empty within the last 7 days
        are skipped via the `dividend_no_div_cache` table — this avoids
        re-hitting yfinance for delisted SPACs and non-dividend tickers.
        Pass force=True to bypass the negative cache and re-verify symbols
        marked as "no dividends" (used by the manual Refresh button).
        """
        from .services.csv_parser import resolve_symbol
        with self._lock:
            if force:
                # Clear the in-memory dividend TTL cache on MarketDataService.
                try:
                    self.market_data._div_cache.clear()
                except Exception:
                    pass

            # Find all symbols that should have dividends (exclude bonds/cash)
            target_syms: Dict[str, dict] = {}
            for h in self.holdings:
                sym = h["symbol"].upper()
                if h.get("market") in ("sg_bond", "cash", "other"):
                    continue
                if sym in target_syms:
                    continue
                target_syms[sym] = {
                    "market": h.get("market", "us"),
                    "currency": h.get("currency", "USD"),
                    "yahoo_symbol": h.get("yahoo_symbol") or sym,
                }
            # Also include symbols from closed positions
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym in target_syms:
                    continue
                try:
                    res = resolve_symbol(sym, t.exchange)
                except Exception:
                    res = None
                if not res or not res.yahoo_symbol:
                    continue
                if res.market in ("sg_bond", "cash", "other"):
                    continue
                target_syms[sym] = {
                    "market": res.market,
                    "currency": t.currency,
                    "yahoo_symbol": res.yahoo_symbol,
                }

            # Skip symbols in the negative cache (confirmed no dividends).
            # force=True bypasses this — re-verifies "no dividend" symbols.
            # We use a short 1-day TTL so newly-declared dividends are picked
            # up within 24 hours via the manual Refresh button, even if the
            # daily scheduler hasn't run yet.
            NO_DIV_TTL = 1 * 86400
            no_div_yf = set() if force else self.db.get_no_div_symbols(NO_DIV_TTL)
            skipped = 0
            for sym in list(target_syms.keys()):
                if target_syms[sym]["yahoo_symbol"] in no_div_yf:
                    del target_syms[sym]
                    skipped += 1

            # Build map of existing events by (symbol, ex_date) so we can merge
            existing: Dict[tuple, dict] = {}
            for e in self.dividend_events:
                key = (e["symbol"].upper(), str(e.get("ex_date", "")))
                existing[key] = e

            refreshed = 0
            new_events: List[dict] = []
            for sym, info in target_syms.items():
                try:
                    fetched = estimate_received_dividends(
                        self.transactions, sym, info["market"], info["currency"],
                        self.market_data, yahoo_symbol=info["yahoo_symbol"],
                    )
                    refreshed += 1
                    # Only mark "no dividends" if yfinance itself has no
                    # history — NOT when the user simply never held at an
                    # ex-date (estimate_received_dividends returns [] then).
                    if has_dividend_history(info["market"], self.market_data, info["yahoo_symbol"]):
                        self.db.clear_no_dividend_mark(info["yahoo_symbol"])
                    else:
                        self.db.mark_no_dividends(info["yahoo_symbol"])
                    for ev in fetched:
                        key = (ev["symbol"].upper(), str(ev.get("ex_date", "")))
                        existing.pop(key, None)  # replace existing
                        new_events.append(ev)
                except Exception as e:
                    logger.debug("dividend refresh failed for %s: %s", sym, e)

            # Keep events for symbols we did NOT refresh (e.g., sg_bond, cash,
            # or symbols in the negative cache) — but only if the symbol still
            # exists in at least one transaction (prune orphaned events).
            active_symbols = {t.symbol.upper() for t in self.transactions}
            self.dividend_events = [
                e for e in existing.values()
                if e["symbol"].upper() in active_symbols
            ] + new_events
            self.dividend_summary = aggregate_dividends(self.dividend_events, self.holdings)
            self.dividends_by_symbol = dividends_to_holdings_map(self.dividend_events)
            self.profile = compute_profile(
                self.transactions, self.roundtrips, self.open_lots,
                self.dividends_by_symbol, base_currency="SGD", fx_service=self.fx,
            )
            self.db.save_dividend_events(self.user_id, self.dividend_events)
            # Clear dashboard cache but keep advice cache (see comment above)
            try:
                self.db.clear_dashboard_cache(self.user_id)
            except Exception:
                pass
            logger.info("Dividend refresh: %d fetched, %d skipped (no-div cache), %d total events (force=%s)",
                        refreshed, skipped, len(self.dividend_events), force)
            return {
                "refreshed_symbols": refreshed,
                "skipped_no_div": skipped,
                "events": len(self.dividend_events),
            }

    def refresh_prices(self, ttl: int = 600, force: bool = False) -> dict:
        """Fetch live quotes for all open holdings in parallel.

        Also backfills prices for sold symbols that have transactions, so that
        the company name is available even after the symbol is no longer held.

        Persists successful quotes to SQLite price_cache; falls back to
        cached prices for delisted / hard-to-find symbols.

        Args:
            ttl: in-memory TTL for MarketDataService (seconds).
        force: when True, bypass both the SQLite price_cache (24h TTL)
            and the MarketDataService in-memory TTL — always hit
            yfinance. Both the daily 6am scheduler and manual "Refresh"
            pass force=True so the user always sees the latest prices
            after the scheduled or manual run completes.
        """
        CACHE_MAX_AGE = 86400  # 24h — use cached price instead of hitting yfinance
        ERROR_CACHE_AGE = 604800  # 7d — delisted stocks are permanent, don't re-fetch often

        with self._lock:
            if force:
                # Drop the in-memory MarketDataService cache so the next
                # get_quotes actually round-trips to yfinance.
                try:
                    self.market_data._cache.clear()
                except Exception:
                    pass

            db_cache = {} if force else self.db.load_all_price_caches()
            now = time.time()

            seen: Dict[str, dict] = {}
            for h in self.holdings:
                sym = h["symbol"]
                seen[sym] = {
                    "symbol": sym,
                    "yahoo_symbol": h.get("yahoo_symbol") or sym,
                    "market": h.get("market", ""),
                    "currency": h.get("currency", "USD"),
                }
            # Also fetch for symbols that have transactions but no current position
            from .services.csv_parser import resolve_symbol
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym in seen:
                    continue
                try:
                    res = resolve_symbol(sym, t.exchange)
                except Exception:
                    res = None
                if not res or not getattr(res, "yahoo_symbol", ""):
                    continue
                seen[sym] = {
                    "symbol": sym,
                    "yahoo_symbol": res.yahoo_symbol,
                    "market": res.market,
                    "currency": t.currency,
                }

            # Use DB cache for symbols with fresh enough prices — skip yfinance.
            # (Skipped entirely when force=True.)
            requests = []
            for sym, req in seen.items():
                cached = db_cache.get(sym.upper())
                if cached is not None:
                    cached_age = now - (cached.get("fetched_at") or 0)
                    max_age = ERROR_CACHE_AGE if cached.get("error") else CACHE_MAX_AGE
                    if cached_age < max_age:
                        self._prices[sym] = cached
                        continue
                requests.append(req)

            if not requests:
                return {"updated": 0}

            self.market_data.ttl = ttl
            quotes = self.market_data.get_quotes(requests, use_cache=not force)
            updated = 0
            for sym, q in quotes.items():
                qd = q.to_dict()
                price_ok = qd.get("price") is not None and not qd.get("error")
                self.db.save_price_cache(sym, qd)
                if price_ok:
                    self._prices[sym] = qd
                    updated += 1
                else:
                    # Fall back to persisted cache for delisted / failing symbols
                    cached = db_cache.get(sym.upper())
                    if cached is not None and cached.get("price") is not None:
                        self._prices[sym] = cached
                    else:
                        self._prices[sym] = qd
            return {"updated": updated}

    def get_prices_map(self) -> Dict[str, dict]:
        return self._prices

    def backfill_transaction_names(self) -> dict:
        """Fetch and persist company names for any transactions missing them.

        Iterates over the in-memory transaction list and the SQLite rows;
        for each unique symbol with no name, calls yfinance and updates
        the in-memory record and the SQLite row.
        """
        from .services.csv_parser import resolve_symbol
        with self._lock:
            seen: set = set()
            updated = 0
            for t in self.transactions:
                if getattr(t, "name", ""):
                    continue
                sym = t.symbol.upper()
                if sym in seen:
                    continue
                seen.add(sym)
                try:
                    res = resolve_symbol(sym, t.exchange)
                except Exception:
                    res = None
                if not res or not getattr(res, "yahoo_symbol", ""):
                    continue
                try:
                    q = self.market_data.get_quote(
                        symbol=sym,
                        yahoo_symbol=res.yahoo_symbol,
                        market=res.market,
                        currency=t.currency,
                    )
                except Exception:
                    continue
                name = q.name or ""
                if not name:
                    continue
                # Update in-memory + cache price for reuse
                self._prices[sym] = q.to_dict()
                for tt in self.transactions:
                    if tt.symbol.upper() == sym:
                        tt.name = name
                # Persist to SQLite
                try:
                    self.db.update_transaction_name_by_symbol(self.user_id, sym, name)
                except AttributeError:
                    pass
                updated += 1
            return {"updated": updated, "checked": len(seen)}

    # ----- public API -----

    def get_summary(self, base_currency: str = "SGD") -> dict:
        with self._lock:
            # Build live FX rates TO the base currency
            fx_rates = {}
            for ccy in set(h["currency"] for h in self.holdings):
                if ccy != base_currency:
                    fx_rates[ccy] = self.fx.get(ccy, base_currency)
            holdings_for_summary = [dict(h) for h in self.holdings]
            return build_portfolio_summary(
                holdings_for_summary,
                self._prices,
                self.dividends_by_symbol,
                base_currency=base_currency,
                fx_rates=fx_rates,
                fx_service=self.fx,
            )

    def recompute_roundtrips_and_lots(self) -> None:
        """Recompute roundtrips, open lots, and holdings from current transactions."""
        with self._lock:
            open_lots, roundtrips, meta = build_holdings_and_roundtrips(self.transactions)
            self.open_lots = open_lots
            self.roundtrips = roundtrips
            self.meta = meta

            realized_by_symbol: Dict[str, float] = {}
            for r in roundtrips:
                realized_by_symbol[r.symbol] = realized_by_symbol.get(r.symbol, 0.0) + r.pnl
            self.realized_by_symbol = realized_by_symbol

            self.holdings = summarize_holdings(open_lots, meta, realized_by_symbol)
            self.holdings_by_symbol = {h["symbol"]: h for h in self.holdings}

            try:
                self._persist_to_db()
            except Exception as e:
                logger.warning("recompute_roundtrips_and_lots persist failed: %s", e)

    def rebuild_dashboard_cache(self, force: bool = False) -> dict:
        """Refresh all live data and rebuild the dashboard cache.

        Order:
        0. Recompute roundtrips & open lots from current transactions
        1. Refresh prices (yfinance quotes)
        2. Refresh dividends (yfinance dividend history — picks up new
           declarations since the last fetch)
        3. Rebuild and persist the dashboard cache (summary, breakdown,
           profile, holdings, dividends, benchmarks)

        This is the single entry point used by the daily scheduler and the
        manual "Refresh" button. Returns counts of what was updated.

        Args:
            force: bypass all caches (SQLite price_cache TTL,
                MarketDataService in-memory TTL, dividend negative cache)
                so the next "Refresh" click always returns the latest data
                from yfinance. Both the daily 6am scheduler and manual
                "Refresh" pass force=True so the cache is always fresh
                when the user loads the dashboard.
        """
        import json
        with self._lock:
            # 0. Keep roundtrips & open lots in sync with current transactions.
            try:
                self.recompute_roundtrips_and_lots()
            except Exception as e:
                logger.warning("recompute_roundtrips_and_lots failed: %s", e, exc_info=True)
            try:
                price_result = self.refresh_prices(force=force)
            except Exception as e:
                logger.warning("refresh_prices failed: %s", e, exc_info=True)
                price_result = {"updated": 0}
            # 2. Dividend history (picks up new declarations)
            try:
                div_result = self.refresh_dividends(force=force)
            except Exception as e:
                logger.warning("refresh_dividends failed: %s", e, exc_info=True)
                div_result = {"refreshed_symbols": 0, "events": len(self.dividend_events)}
            # 3. Build the cache
            try:
                fx_rates = {}
                for h in self.holdings:
                    ccy = h.get("currency", "USD")
                    if ccy != "SGD":
                        fx_rates[ccy] = self.fx.get(ccy, "SGD")
                holdings_for_summary = [dict(h) for h in self.holdings]
                summary = build_portfolio_summary(
                    holdings_for_summary, self._prices, self.dividends_by_symbol,
                    base_currency="SGD", fx_rates=fx_rates, fx_service=self.fx,
                )
                breakdown = self.get_currency_breakdown(base_currency="SGD")
                profile = self.get_profile()
                holdings = self.get_holdings()
                dividends = self.get_dividends()
                benchmarks = self.get_benchmarks()
                now_ts = time.time()
                cache = {
                    "summary": summary,
                    "breakdown": breakdown,
                    "profile": profile,
                    "holdings": holdings,
                    "dividends": dividends,
                    "benchmarks": benchmarks,
                    "last_refreshed_at": now_ts,
                }
                self.db.save_dashboard_cache(self.user_id, "dashboard", json.dumps(cache, default=str))
            except Exception as e:
                logger.error("rebuild_dashboard_cache failed in cache build: %s", e, exc_info=True)
                raise
            logger.info("Dashboard cache rebuilt (prices=%d, divs=%d symbols)",
                        price_result.get("updated", 0), div_result.get("refreshed_symbols", 0))
            self._invalidate_networth_cache()
            # Return both the cache (for the dashboard endpoint fall-through)
            # and counts (for the cache/refresh endpoint to surface to the UI).
            return {
                "cache": cache,
                "holdings": len(holdings),
                "prices_updated": price_result.get("updated", 0),
                "dividends_refreshed": div_result.get("refreshed_symbols", 0),
                "dividend_events": div_result.get("events", 0),
            }

    def get_dashboard_cache(self) -> Optional[dict]:
        """Load dashboard cache. Returns None only if missing (no TTL).

        Returns a dict that always has a `last_refreshed_at` key. New
        caches have it embedded in the JSON payload; legacy caches
        (built before this field existed) fall back to the SQLite
        `updated_at` column so the UI can still show a timestamp.
        """
        cached = self.db.load_dashboard_cache(self.user_id, "dashboard")
        if cached is None:
            return None
        data = cached["data"]
        if "last_refreshed_at" not in data:
            data["last_refreshed_at"] = cached.get("updated_at")
        return data

    # ----- advice cache -----

    @staticmethod
    def _advice_cache_key(focus: str, custom_question: Optional[str], source: str = "llm") -> str:
        """Stable cache key per (focus, custom_question, source).

        `source` lets us keep separate slots for LLM and rule-based reports.
        The LLM slot is preferred on read; the rule-based slot acts as an
        instant fallback so the user never sees a 60s spinner when the LLM
        proxy is slow.
        """
        q = (custom_question or "").strip().lower()
        if not q:
            return f"advice:{focus}:{source}"
        import hashlib
        h = hashlib.md5(q.encode("utf-8")).hexdigest()[:10]
        return f"advice:{focus}:{source}:{h}"

    def get_advice_cache(self, focus: str, custom_question: Optional[str], prefer: str = "llm") -> Optional[dict]:
        """Return the cached advice report for (focus, custom_question), or None.

        Prefers the requested source slot (default: LLM). Falls back to the
        other slot if absent so the user always gets an instant response if
        *any* cached report exists.
        """
        fallback = "rule" if prefer == "llm" else "llm"
        for src in (prefer, fallback):
            key = self._advice_cache_key(focus, custom_question, source=src)
            cached = self.db.load_dashboard_cache(self.user_id, key)
            if cached is None:
                continue
            data = cached.get("data") or {}
            if data.get("raw_markdown"):
                return data
        return None

    def save_advice_cache(self, focus: str, custom_question: Optional[str], report: dict) -> None:
        """Persist an advice report so the LLM isn't called on every refresh.

        Cached in a slot keyed by report['source'] so LLM and rule-based
        reports don't overwrite each other.
        """
        source = report.get("source") or "llm"
        key = self._advice_cache_key(focus, custom_question, source=source)
        import json
        self.db.save_dashboard_cache(
            self.user_id, key, json.dumps(report, default=str)
        )

    def clear_advice_cache(self) -> None:
        """Invalidate all advice reports for this user (e.g. after data changes)."""
        with self.db._conn() as conn:
            conn.execute(
                "DELETE FROM dashboard_cache WHERE user_id = ? AND key LIKE 'advice:%'",
                (self.user_id,),
            )

    def get_benchmarks(self) -> dict:
        """Fetch day-change for major US indices: S&P 500, NASDAQ, Dow Jones."""
        benchmarks = {}
        indices = [
            ("sp500", "^GSPC", "S&P 500"),
            ("nasdaq", "^IXIC", "NASDAQ"),
            ("dow", "^DJI", "Dow Jones"),
        ]
        for key, yahoo_symbol, name in indices:
            try:
                q = self.market_data.get_quote(
                    symbol=yahoo_symbol,
                    yahoo_symbol=yahoo_symbol,
                    market="us",
                    currency="USD",
                )
                benchmarks[key] = {
                    "name": name,
                    "price": q.price,
                    "previous_close": q.previous_close,
                    "change_pct": q.change_pct,
                }
            except Exception as e:
                logger.debug("benchmark %s fetch failed: %s", key, e)
                benchmarks[key] = {"name": name, "error": str(e)}
        return benchmarks

    def get_holdings(self) -> List[dict]:
        with self._lock:
            out = []
            for h in self.holdings:
                hh = dict(h)
                price = self._prices.get(h["symbol"], {})
                hh["current_price"] = price.get("price")
                hh["previous_close"] = price.get("previous_close")
                hh["change_pct"] = price.get("change_pct")
                hh["name"] = price.get("name")
                # 7-day price change for the "Top movers" widget on Dashboard.
                # Uses the in-process TTL cache (1h) to avoid repeated yfinance calls.
                # Returns None for bonds/cash (no live price to compare).
                yf_sym = h.get("yahoo_symbol") or h["symbol"]
                if h.get("market") in ("sg_bond", "cash", "other"):
                    hh["change_pct_7d"] = None
                else:
                    hh["change_pct_7d"] = self.market_data.get_7d_change(yf_sym)
                # Market value: use live price if available, otherwise cost basis
                # (correct for savings bonds and cash which are held at par).
                cur_px = hh.get("current_price")
                prev_px = hh.get("previous_close")
                if cur_px is not None:
                    hh["market_value"] = round(hh["quantity"] * cur_px, 2)
                    hh["unrealized_pnl"] = round((cur_px - hh["avg_cost"]) * hh["quantity"], 2) if hh.get("avg_cost") else 0.0
                    hh["unrealized_pnl_pct"] = round((cur_px - hh["avg_cost"]) / hh["avg_cost"], 4) if hh.get("avg_cost") else 0.0
                    if prev_px:
                        # Day change in the holding's native currency
                        hh["day_change"] = round((cur_px - prev_px) * hh["quantity"], 2)
                        hh["day_change_pct"] = round((cur_px - prev_px) / prev_px, 4)
                    else:
                        hh["day_change"] = 0.0
                        hh["day_change_pct"] = 0.0
                else:
                    hh["market_value"] = hh["cost_basis"]
                    hh["unrealized_pnl"] = 0.0
                    hh["unrealized_pnl_pct"] = 0.0
                    hh["day_change"] = 0.0
                    hh["day_change_pct"] = 0.0
                hh["dividends_received"] = round(self.dividends_by_symbol.get(h["symbol"], 0.0), 2)
                out.append(hh)
            return out

    def get_transactions(self) -> List[dict]:
        with self._lock:
            out = []
            for t in sorted(self.transactions, key=lambda x: x.date, reverse=True):
                sym = t.symbol.upper()
                # Resolve name: prefer in-memory, fall back to live price cache
                name = getattr(t, "name", "") or ""
                if not name:
                    price = self._prices.get(sym, {})
                    name = price.get("name") or ""
                hh = {
                    "id": t.id,
                    "date": t.date.isoformat(),
                    "side": t.side,
                    "symbol": sym,
                    "exchange": t.exchange,
                    "quantity": t.quantity,
                    "price": t.price,
                    "gross_amount": t.gross_amount,
                    "net_amount": t.net_amount,
                    "fees": t.fees,
                    "currency": t.currency,
                    "label": t.label,
                    "note": t.note,
                    "name": name,
                }
                out.append(hh)
            return out

    def get_roundtrips(self) -> List[dict]:
        with self._lock:
            # Build a name map from transactions (backfilled) and price cache
            name_map: Dict[str, str] = {}
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym not in name_map:
                    nm = getattr(t, "name", "") or ""
                    if not nm:
                        nm = (self._prices.get(sym, {}) or {}).get("name") or ""
                    if nm:
                        name_map[sym] = nm
            return [
                {
                    "symbol": r.symbol,
                    "market": r.market,
                    "currency": r.currency,
                    "yahoo_symbol": r.yahoo_symbol,
                    "exchange": r.exchange,
                    "buy_date": r.buy_date.isoformat(),
                    "sell_date": r.sell_date.isoformat(),
                    "quantity": round(r.quantity, 4),
                    "original_buy_qty": round(r.original_buy_qty, 4),
                    "buy_price": round(r.buy_price, 4),
                    "sell_price": round(r.sell_price, 4),
                    "cost": round(r.cost, 2),
                    "proceeds": round(r.proceeds, 2),
                    "fees": round(r.fees, 2),
                    "pnl": round(r.pnl, 2),
                    "pnl_pct": round(r.pnl_pct, 4),
                    "hold_days": r.hold_days,
                    "name": name_map.get(r.symbol.upper(), ""),
                }
                for r in sorted(self.roundtrips, key=lambda x: x.buy_date)
            ]

    def get_dividends(self) -> dict:
        with self._lock:
            summary = dict(self.dividend_summary)
            base_ccy = "SGD"

            def to_base(amt: float, ccy: str) -> float:
                if not amt or ccy == base_ccy:
                    return amt
                try:
                    return amt * self.fx.get(ccy, base_ccy)
                except Exception:
                    return 0.0

            # Add base-currency total + by-year-base
            total_base = sum(
                to_base(e.get("total_received", 0) or 0, e.get("currency", ""))
                for e in self.dividend_events
            )
            summary["total_received_base"] = round(total_base, 2)
            summary["base_currency"] = base_ccy

            by_year_base: Dict[str, float] = defaultdict(float)
            for e in self.dividend_events:
                y = (e.get("ex_date") or "")[:4] or "unknown"
                by_year_base[y] += to_base(e.get("total_received", 0) or 0, e.get("currency", ""))
            summary["by_year_base"] = {y: round(v, 2) for y, v in sorted(by_year_base.items())}

            # Annotate by_symbol with total in base currency
            by_symbol_base: Dict[str, float] = defaultdict(float)
            for e in self.dividend_events:
                by_symbol_base[e["symbol"]] += to_base(
                    e.get("total_received", 0) or 0, e.get("currency", "")
                )
            summary["by_symbol"] = [
                {**row, "total_base": round(by_symbol_base.get(row["symbol"], 0.0), 2)}
                for row in summary.get("by_symbol", [])
            ]

            # Build a name map from transactions (backfilled) and price cache
            name_map: Dict[str, str] = {}
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym not in name_map:
                    nm = getattr(t, "name", "") or ""
                    if not nm:
                        nm = (self._prices.get(sym, {}) or {}).get("name") or ""
                    if nm:
                        name_map[sym] = nm
            events = []
            for e in sorted(self.dividend_events, key=lambda x: x["ex_date"], reverse=True):
                ee = dict(e)
                if not ee.get("name"):
                    sym = e.get("symbol", "")
                    ee["name"] = name_map.get(sym.upper(), "")
                events.append(ee)
            return {"summary": summary, "events": events}

    def get_profile(self) -> dict:
        with self._lock:
            return self.profile

    def get_prices(self) -> List[dict]:
        with self._lock:
            return list(self._prices.values())

    def get_networth_history(self, period: str = "1y") -> dict:
        """Compute net worth at each month-end for the last 12 months.

        Uses a single batched yfinance call (`yf.download`) for all symbols +
        FX pairs — 1 HTTP request total. Results are cached in memory for 24h
        since monthly closes rarely change and the current month's close
        updates daily.

        Falls back to a cumulative-cost-basis series (no market data) if
        yfinance returns no data.
        """
        import pandas as pd
        import yfinance as yf
        from .services.csv_parser import resolve_symbol

        cache_key = f"{self.user_id}:networth"
        now = time.time()
        cached = self._networth_cache.get(cache_key)
        if cached and (now - cached[1]) < 86400:
            return cached[0]

        with self._lock:
            if not self.transactions:
                return {"base_currency": "SGD", "history": []}

            base_currency = "SGD"

            symbol_info: Dict[str, dict] = {}
            for t in self.transactions:
                sym = t.symbol.upper()
                if sym not in symbol_info:
                    res = resolve_symbol(t.symbol, t.exchange)
                    symbol_info[sym] = {
                        "currency": t.currency,
                        "yahoo_symbol": res.yahoo_symbol,
                        "has_price": bool(res.yahoo_symbol) and res.market not in {"cash", "sg_bond", "fund", "other"},
                    }

            yahoo_symbols = sorted({info["yahoo_symbol"] for info in symbol_info.values() if info["yahoo_symbol"]})
            needed_ccys = sorted({info["currency"] for info in symbol_info.values()} - {base_currency})
            fx_pairs = [f"{ccy}{base_currency}=X" for ccy in needed_ccys]
            all_tickers = yahoo_symbols + fx_pairs

            close_df = pd.DataFrame()
            if all_tickers:
                try:
                    data = yf.download(
                        all_tickers,
                        period="1y",
                        interval="1mo",
                        progress=False,
                        auto_adjust=False,
                    )
                    if isinstance(data, pd.DataFrame) and not data.empty:
                        if isinstance(data.columns, pd.MultiIndex):
                            level0 = data.columns.get_level_values(0)
                            if "Close" in level0:
                                close_df = data["Close"].copy()
                            else:
                                close_df = pd.DataFrame()
                        elif "Close" in data.columns:
                            close_df = data[["Close"]].copy()
                            close_df.columns = all_tickers
                        if not close_df.empty:
                            try:
                                close_df.index = close_df.index.tz_localize(None)
                            except Exception:
                                pass
                            close_df = close_df.ffill().bfill()
                except Exception as e:
                    logger.warning("networth history yf.download failed: %s", e)

            today = date.today()

            if not close_df.empty:
                month_ends = sorted({d.date() for d in close_df.index})
            else:
                first_tx = min(t.date for t in self.transactions)
                start = max(date(today.year - 1, today.month, 1), first_tx.replace(day=1))
                month_ends = []
                y, m = start.year, start.month
                for _ in range(13):
                    month_ends.append(date(y, m, 1))
                    m += 1
                    if m > 12:
                        m = 1
                        y += 1
                month_ends = [d for d in month_ends if d <= today][-12:]

            date_map = dict(zip(month_ends, month_ends))

            today = date.today()
            first_tx_date = min(t.date for t in self.transactions)
            txs_sorted = sorted(self.transactions, key=lambda t: t.date)

            current_mv_base = 0.0
            current_cost_base = 0.0
            for h in self.holdings:
                ccy = h.get("currency", "USD")
                lots = h.get("lots") or []
                if lots:
                    for lot in lots:
                        acq = lot.get("acquired")
                        rate = 1.0 if ccy == base_currency else (
                            self.fx.get_historical_rate(ccy, base_currency, acq) if acq
                            else self.fx.get(ccy, base_currency)
                        )
                        current_cost_base += lot["cost_basis"] * rate
                else:
                    rate = 1.0 if ccy == base_currency else self.fx.get(ccy, base_currency)
                    current_cost_base += h["cost_basis"] * rate
                price_info = self._prices.get(h["symbol"], {})
                cur_px = price_info.get("price")
                if cur_px is not None and not (isinstance(cur_px, float) and math.isnan(cur_px)):
                    rate = 1.0 if ccy == base_currency else self.fx.get(ccy, base_currency)
                    current_mv_base += h["quantity"] * cur_px * rate
                elif h.get("market") in {"sg_bond", "cash"}:
                    rate = 1.0 if ccy == base_currency else self.fx.get(ccy, base_currency)
                    current_mv_base += h["cost_basis"] * rate
            unrealized_offset = current_mv_base - current_cost_base

            net_buy_by_month: Dict[date, float] = {d: 0.0 for d in month_ends}
            for d in month_ends:
                month_net = 0.0
                for t in txs_sorted:
                    if t.date.year > d.year or (t.date.year == d.year and t.date.month > d.month):
                        break
                    if t.date.year != d.year or t.date.month != d.month:
                        continue
                    amt = t.net_amount if t.side == "buy" else -t.net_amount
                    if t.currency == base_currency:
                        month_net += amt
                    else:
                        rate = self.fx.get_historical_rate(t.currency, base_currency, t.date.isoformat())
                        month_net += amt * rate
                net_buy_by_month[d] = round(month_net, 2)

            history = []
            for d in month_ends:
                cum_qty: Dict[str, float] = defaultdict(float)
                cum_cost: Dict[str, float] = defaultdict(float)
                for t in txs_sorted:
                    if t.date > d:
                        break
                    sym = t.symbol.upper()
                    if sym in symbol_info:
                        q = t.quantity if t.side == "buy" else -t.quantity
                        cum_qty[sym] += q
                        if t.side == "buy":
                            cum_cost[sym] += t.quantity * t.price + t.fees
                        else:
                            old_qty = cum_qty[sym] - q
                            if old_qty > 0:
                                ratio = t.quantity / old_qty
                                cum_cost[sym] = max(0.0, cum_cost[sym] * (1 - ratio))

                nw = 0.0
                have_market_data = not close_df.empty
                is_current_month = (d.year, d.month) == (today.year, today.month)

                if have_market_data:
                    mask = close_df.index.date <= d
                    for sym, qty in cum_qty.items():
                        if qty <= 1e-9:
                            continue
                        info = symbol_info[sym]
                        ccy = info["currency"]
                        if info["has_price"]:
                            if is_current_month:
                                price_info = self._prices.get(sym, {})
                                cur_px = price_info.get("price")
                                if cur_px is not None and not (isinstance(cur_px, float) and math.isnan(cur_px)):
                                    price = float(cur_px)
                                    rate = 1.0 if ccy == base_currency else self.fx.get(ccy, base_currency)
                                    nw += qty * price * rate
                                    continue
                            ysym = info["yahoo_symbol"]
                            if ysym not in close_df.columns or not mask.any():
                                continue
                            px_series = close_df.loc[mask, ysym].dropna()
                            if px_series.empty:
                                continue
                            price = float(px_series.iloc[-1])
                            if ccy == base_currency:
                                rate = 1.0
                            else:
                                fx_ticker = f"{ccy}{base_currency}=X"
                                if fx_ticker in close_df.columns:
                                    fx_series = close_df.loc[mask, fx_ticker].dropna()
                                    rate = float(fx_series.iloc[-1]) if not fx_series.empty else self.fx.get_historical_rate(ccy, base_currency, d.isoformat())
                                else:
                                    rate = self.fx.get_historical_rate(ccy, base_currency, d.isoformat())
                            nw += qty * price * rate
                        else:
                            cost = cum_cost.get(sym, 0.0)
                            rate = 1.0 if ccy == base_currency else (
                                self.fx.get(ccy, base_currency) if is_current_month
                                else self.fx.get_historical_rate(ccy, base_currency, d.isoformat()))
                            nw += cost * rate
                else:
                    for t in txs_sorted:
                        if t.date > d:
                            break
                        amt = t.net_amount if t.side == "buy" else -t.net_amount
                        if t.currency == base_currency:
                            nw += amt
                        else:
                            rate = self.fx.get_historical_rate(t.currency, base_currency, t.date.isoformat())
                            nw += amt * rate
                    nw += unrealized_offset

                history.append({
                    "date": date_map[d].isoformat(),
                    "net_worth": round(nw, 2),
                    "net_buy_sell": net_buy_by_month[d],
                })

            result = {"base_currency": base_currency, "history": history}
            self._networth_cache[cache_key] = (result, time.time())
            return result

    # ----- currency breakdown (the dashboard's headline table) -----

    def get_currency_breakdown(self, base_currency: str = "SGD") -> dict:
        with self._lock:
            holdings = self.get_holdings()
            ccy_needed = sorted({h.get("currency", "USD") for h in holdings}
                                | {r.currency for r in self.roundtrips}
                                | {e["currency"] for e in self.dividend_events}
                                | {t.currency for t in self.transactions})
            fx_rates = {c: self.fx.get(c, base_currency) for c in ccy_needed}
            fx_rates[base_currency] = 1.0

            # Build dividends_by_symbol_ccy: nested dict symbol -> ccy -> total
            # Each dividend event contributes to its symbol's per-ccy total.
            divs_by_sym_ccy: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
            for e in self.dividend_events:
                divs_by_sym_ccy[e["symbol"]][e["currency"]] += e["total_received"]
            divs_by_sym_ccy = {k: dict(v) for k, v in divs_by_sym_ccy.items()}

            # Capital = cost basis of currently-open holdings (per currency, native)
            # Excludes fully-closed positions.
            # Each lot is converted at the historical FX rate on its acquisition date.
            capital_in_by_ccy: Dict[str, float] = defaultdict(float)
            capital_base = 0.0
            for h in self.holdings:
                ccy = h["currency"]
                capital_in_by_ccy[ccy] += h["cost_basis"]
                lots = h.get("lots") or []
                for lot in lots:
                    acquired = lot.get("acquired")
                    if acquired and ccy != base_currency:
                        hist_rate = self.fx.get_historical_rate(ccy, base_currency, acquired)
                        capital_base += lot["cost_basis"] * hist_rate
                    else:
                        capital_base += lot["cost_basis"]
                if not lots and ccy != base_currency:
                    capital_base += h["cost_basis"] * self.fx.get(ccy, base_currency)
                elif not lots:
                    capital_base += h["cost_basis"]

            breakdown = build_currency_breakdown(
                holdings, self.roundtrips, self.transactions,
                divs_by_sym_ccy, self._prices,
                base_currency=base_currency, fx_rates=fx_rates,
                capital_in_by_ccy=dict(capital_in_by_ccy),
                total_capital_base=capital_base,
                fx_service=self.fx,
            )

            # ----- header metrics in base currency -----
            current_value_base = breakdown["totals"]["current_value"]
            realised_base = sum(
                r.pnl * (fx_rates.get(r.currency, 1.0))
                for r in self.roundtrips
            )
            divs_base = sum(
                e["total_received"] * (fx_rates.get(e["currency"], 1.0))
                for e in self.dividend_events
            )
            twr = compute_twr(
                capital_in_base=capital_base,
                current_value_base=current_value_base,
                realised_base=realised_base,
                dividends_base=divs_base,
            )
            # For XIRR, we need cash flows. The XIRR should use BUY amounts as
            # outflows, SELL amounts as inflows, and the final current value as
            # a terminal inflow. This handles re-buys of the same stock
            # correctly because each BUY is its own cash flow event.
            xirr = compute_xirr(
                self.transactions, current_value_base,
                base_currency=base_currency, fx_rates=fx_rates,
                fx_service=self.fx,
            )

            return {
                **breakdown,
                "header": {
                    "twr": round(twr, 4),
                    "xirr": round(xirr, 4),
                    "capital": round(capital_base, 2),
                    "net_worth": round(current_value_base, 2),
                    "base_currency": base_currency,
                },
            }
