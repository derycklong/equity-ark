"""Portfolio engine.

Computes holdings (with FIFO cost basis), realized roundtrips, and a profile
metrics block. Adapted from Vibe-Trading's pair_trades_fifo (agent/src/tools/
trade_journal_tool.py:33).
"""
from __future__ import annotations

import math
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date
from typing import Dict, Iterable, List, Optional, Tuple

from .csv_parser import RawTransaction, resolve_symbol


# ----------------------------- lot / holding ---------------------------------

@dataclass
class Lot:
    """One open buy lot for a symbol."""
    acquired: date
    quantity: float
    price: float
    original_quantity: float = 0.0  # total bought; never changes. quantity shrinks as sells consume it.
    fees: float = 0.0
    label: str = ""
    exchange: str = ""
    currency: str = ""
    yahoo_symbol: str = ""
    market: str = ""
    note: str = ""

    @property
    def cost_basis(self) -> float:
        return self.quantity * self.price + self.fees


@dataclass
class Roundtrip:
    symbol: str
    market: str
    currency: str
    yahoo_symbol: str
    exchange: str
    buy_date: date
    sell_date: date
    quantity: float          # quantity sold in this roundtrip leg
    original_buy_qty: float  # total quantity of the original buy lot
    buy_price: float
    sell_price: float
    fees: float
    cost: float
    proceeds: float
    pnl: float
    pnl_pct: float
    hold_days: float


# ----------------------------- engine ---------------------------------------

def build_holdings_and_roundtrips(
    transactions: Iterable[RawTransaction],
) -> Tuple[Dict[str, List[Lot]], List[Roundtrip], Dict[str, dict]]:
    """Run FIFO matching across all transactions.

    Returns:
        open_lots:   symbol -> list of open Lot
        roundtrips:  list of completed Roundtrip
        meta:        symbol -> {market, currency, exchange, yahoo_symbol, label}
    """
    sorted_tx = sorted(transactions, key=lambda t: (t.date, getattr(t, 'id', 0) or 0))

    queues: Dict[str, deque[Lot]] = defaultdict(deque)
    roundtrips: List[Roundtrip] = []
    meta: Dict[str, dict] = {}

    for tx in sorted_tx:
        if tx.quantity <= 0 or tx.price <= 0:
            continue
        res = tx.resolution()
        sym = tx.symbol.upper()
        if sym not in meta:
            meta[sym] = {
                "market": res.market,
                "currency": tx.currency,
                "exchange": tx.exchange,
                "yahoo_symbol": res.yahoo_symbol,
                "label": tx.label,
            }

        if tx.side == "buy":
            lot = Lot(
                acquired=tx.date,
                quantity=tx.quantity,
                original_quantity=tx.quantity,
                price=tx.price,
                fees=tx.fees,
                label=tx.label,
                exchange=tx.exchange,
                currency=tx.currency,
                yahoo_symbol=res.yahoo_symbol,
                market=res.market,
                note=tx.note,
            )
            queues[sym].append(lot)
            continue

        # sell — match against oldest buys of the SAME currency only.
        remaining = tx.quantity
        q = queues[sym]
        idx = 0
        while idx < len(q) and q[idx].currency != tx.currency:
            idx += 1
        while remaining > 1e-9 and idx < len(q):
            lot = q[idx]
            take = min(lot.quantity, remaining)
            hold_days = (tx.date - lot.acquired).days
            gross = (tx.price - lot.price) * take
            buy_fee = lot.fees * (take / lot.quantity) if lot.quantity else 0.0
            sell_fee = tx.fees * (take / tx.quantity) if tx.quantity else 0.0
            pnl = gross - buy_fee - sell_fee
            cost = lot.price * take
            pnl_pct = pnl / cost if cost else 0.0
            roundtrips.append(Roundtrip(
                symbol=sym,
                market=res.market,
                currency=tx.currency,
                yahoo_symbol=res.yahoo_symbol,
                exchange=tx.exchange,
                buy_date=lot.acquired,
                sell_date=tx.date,
                quantity=take,
                original_buy_qty=lot.original_quantity,
                buy_price=lot.price,
                sell_price=tx.price,
                fees=buy_fee + sell_fee,
                cost=cost,
                proceeds=tx.price * take,
                pnl=pnl,
                pnl_pct=pnl_pct,
                hold_days=hold_days,
            ))
            lot.quantity -= take
            remaining -= take
            if lot.quantity <= 1e-9:
                del q[idx]
                while idx < len(q) and q[idx].currency != tx.currency:
                    idx += 1
            else:
                break

    open_lots: Dict[str, List[Lot]] = {sym: list(lots) for sym, lots in queues.items() if lots}
    return open_lots, roundtrips, meta


def summarize_holdings(
    open_lots: Dict[str, List[Lot]],
    meta: Dict[str, dict],
    realized_pnl: Dict[str, float],
) -> List[dict]:
    """Aggregate open lots into per-symbol holdings.

    avg_cost = cost_basis / quantity of REMAINING open lots.
    This is the standard FIFO cost basis for the position currently held.
    Closed positions are reflected in `realized_pnl` (and the combined P&L
    column in the UI), not in the avg_cost of remaining shares.

    A symbol traded on multiple exchanges in different currencies (e.g.,
    SNOW on both USX/USD and HKEX/HKD) produces a separate holding per
    currency — otherwise the cost_basis would mix currencies and be
    meaningless.
    """
    out: List[dict] = []
    for sym, lots in open_lots.items():
        if not lots:
            continue
        m = meta.get(sym, {})

        by_ccy: Dict[str, List[Lot]] = {}
        for lot in lots:
            by_ccy.setdefault(lot.currency, []).append(lot)

        for ccy, ccy_lots in by_ccy.items():
            qty = sum(l.quantity for l in ccy_lots)
            cost = sum(l.cost_basis for l in ccy_lots)
            avg_cost = cost / qty if qty else 0.0

            out.append({
                "symbol": sym,
                "market": m.get("market", "other"),
                "currency": ccy,
                "exchange": m.get("exchange", ""),
                "yahoo_symbol": m.get("yahoo_symbol", sym),
                "quantity": round(qty, 6),
                "cost_basis": round(cost, 2),
                "avg_cost": round(avg_cost, 4),
                "realized_pnl": round(realized_pnl.get(sym, 0.0), 2),
                "first_acquired": min(l.acquired for l in ccy_lots).isoformat(),
                "lots": [
                    {
                        "acquired": l.acquired.isoformat(),
                        "quantity": round(l.quantity, 6),
                        "price": round(l.price, 4),
                        "cost_basis": round(l.cost_basis, 2),
                        "fees": round(l.fees, 2),
                    }
                    for l in ccy_lots
                ],
                "label": m.get("label", ""),
            })
    out.sort(key=lambda h: -(h["cost_basis"]))
    return out


# ----------------------------- profile metrics -------------------------------

def _safe_div(a: float, b: float) -> float:
    return float(a) / float(b) if b else 0.0


def compute_profile(
    transactions: List[RawTransaction],
    roundtrips: List[Roundtrip],
    open_lots: Dict[str, List[Lot]],
    dividends_by_symbol: Optional[Dict[str, float]] = None,
    base_currency: str = "SGD",
    fx_service=None,
) -> dict:
    if not transactions:
        return {
            "total_transactions": 0,
            "total_roundtrips": 0,
            "open_positions": 0,
            "win_rate": 0.0,
            "avg_winner": 0.0,
            "avg_loser": 0.0,
            "profit_loss_ratio": 0.0,
            "avg_holding_days": 0.0,
            "total_realized_pnl": 0.0,
            "total_fees": 0.0,
            "total_dividends": 0.0,
            "largest_winner": 0.0,
            "largest_loser": 0.0,
            "span_days": 0,
            "start_date": None,
            "end_date": None,
            "top_symbols": [],
            "market_distribution": {},
            "best_roundtrip": None,
            "worst_roundtrip": None,
        }

    sorted_tx = sorted(transactions, key=lambda t: t.date)
    start = sorted_tx[0].date
    end = sorted_tx[-1].date
    span_days = max(1, (end - start).days)
    total_fees = sum(t.fees for t in transactions)

    def _to_base(amount: float, ccy: str, date_str: str) -> float:
        if ccy == base_currency:
            return amount
        if fx_service and hasattr(fx_service, "get_historical_rate"):
            try:
                return amount * fx_service.get_historical_rate(ccy, base_currency, date_str)
            except Exception:
                pass
        return amount  # no FX conversion possible

    # Convert each roundtrip to base currency using historical FX on sell date
    rt_base = []
    for r in roundtrips:
        sell_iso = r.sell_date.isoformat() if hasattr(r.sell_date, "isoformat") else str(r.sell_date)
        pnl_base = _to_base(r.pnl, r.currency, sell_iso)
        rt_base.append((r, pnl_base))

    total_realized_base = sum(p for _, p in rt_base)

    # Win/loss using native pnl (consistent with how it was always computed)
    wins = [r for r in roundtrips if r.pnl > 0]
    losses = [r for r in roundtrips if r.pnl < 0]
    avg_winner = sum(r.pnl for r in wins) / len(wins) if wins else 0.0
    avg_loser = sum(r.pnl for r in losses) / len(losses) if losses else 0.0
    win_rate = len(wins) / len(roundtrips) if roundtrips else 0.0
    pnl_ratio = _safe_div(avg_winner, abs(avg_loser)) if losses and wins else 0.0
    avg_hold = sum(r.hold_days for r in roundtrips) / len(roundtrips) if roundtrips else 0.0

    # Realized PnL by symbol (in base currency)
    by_sym: Dict[str, float] = defaultdict(float)
    for r, p in rt_base:
        by_sym[r.symbol] += p
    top = sorted(by_sym.items(), key=lambda x: -x[1])[:10]

    # Market distribution by trade count
    market_dist: Dict[str, int] = defaultdict(int)
    for t in transactions:
        market_dist[resolve_symbol(t.symbol, t.exchange).market] += 1

    # best/worst by base-currency PnL for consistency with total
    best = max(rt_base, key=lambda x: x[1], default=None)
    worst = min(rt_base, key=lambda x: x[1], default=None)

    return {
        "total_transactions": len(transactions),
        "total_roundtrips": len(roundtrips),
        "open_positions": len(open_lots),
        "win_rate": round(win_rate, 4),
        "avg_winner": round(avg_winner, 2),
        "avg_loser": round(avg_loser, 2),
        "profit_loss_ratio": round(pnl_ratio, 2),
        "avg_holding_days": round(avg_hold, 2),
        "total_realized_pnl": round(total_realized_base, 2),
        "total_fees": round(total_fees, 2),
        "total_dividends": round(sum((dividends_by_symbol or {}).values()), 2),
        "largest_winner": round(best[1], 2) if best else 0.0,
        "largest_loser": round(worst[1], 2) if worst else 0.0,
        "span_days": span_days,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "top_symbols": [{"symbol": s, "pnl": round(p, 2)} for s, p in top],
        "market_distribution": dict(market_dist),
        "best_roundtrip": {
            "symbol": best[0].symbol, "pnl": round(best[1], 2),
            "buy_date": best[0].buy_date.isoformat(), "sell_date": best[0].sell_date.isoformat(),
            "qty": round(best[0].quantity, 2), "pnl_pct": round(best[0].pnl_pct, 4),
        } if best else None,
        "worst_roundtrip": {
            "symbol": worst[0].symbol, "pnl": round(worst[1], 2),
            "buy_date": worst[0].buy_date.isoformat(), "sell_date": worst[0].sell_date.isoformat(),
            "qty": round(worst[0].quantity, 2), "pnl_pct": round(worst[0].pnl_pct, 4),
        } if worst else None,
    }


def build_portfolio_summary(holdings: List[dict], prices: Dict[str, dict],
                            dividends_by_symbol: Dict[str, float],
                            base_currency: str = "USD",
                            fx_rates: Optional[Dict[str, float]] = None,
                            fx_service=None) -> dict:
    fx = fx_rates or {"USD": 1.0, "HKD": 0.128, "SGD": 0.74, "GBP": 1.27, "CNY": 0.14}

    def _hist_rate(ccy: str, date_str: str) -> float:
        """Historical FX rate to base currency on a given date."""
        if ccy == base_currency:
            return 1.0
        if fx_service:
            return fx_service.get_historical_rate(ccy, base_currency, date_str)
        return fx.get(ccy, 1.0)

    total_cost = 0.0
    total_mv = 0.0
    total_unrealized = 0.0
    total_realized = 0.0
    total_day_change = 0.0
    # Convert dividends to base currency per symbol
    sym_currency = {h["symbol"]: h["currency"] for h in holdings}
    total_dividends = 0.0
    for sym, amt in dividends_by_symbol.items():
        ccy = sym_currency.get(sym, "USD")
        total_dividends += amt * fx.get(ccy, 1.0)

    by_market: Dict[str, dict] = defaultdict(lambda: {"cost": 0.0, "value": 0.0, "count": 0})
    by_currency: Dict[str, dict] = defaultdict(lambda: {"cost": 0.0, "value": 0.0, "count": 0})

    for h in holdings:
        cur = h["currency"]
        fx_rate = fx.get(cur, 1.0)

        # Cost in base currency using historical FX rate per lot
        lots = h.get("lots") or []
        if lots:
            cost_base = sum(
                l["cost_basis"] * _hist_rate(cur, l["acquired"])
                for l in lots
            )
        else:
            cost_base = h["cost_basis"] * fx_rate

        total_cost += cost_base
        total_realized += h["realized_pnl"] * fx_rate

        price_info = prices.get(h["symbol"], {})
        current_price = price_info.get("price")
        prev_close = price_info.get("previous_close")
        if current_price is not None:
            mv_native = h["quantity"] * current_price
            mv_base = mv_native * fx_rate  # market value always at today's rate
            unreal = mv_base - cost_base  # captures stock gain + FX gain
            total_mv += mv_base
            total_unrealized += unreal
            if prev_close:
                day_chg = (current_price - prev_close) * h["quantity"] * fx_rate
                total_day_change += day_chg
                h["day_change"] = round(day_chg, 2)
            else:
                h["day_change"] = 0.0
            h["current_price"] = round(current_price, 4)
            h["market_value"] = round(mv_native, 2)
            h["unrealized_pnl"] = round(mv_native - h.get("cost_basis", 0), 2)
            h["unrealized_pnl_pct"] = round((current_price - h["avg_cost"]) / h["avg_cost"], 4) if h["avg_cost"] else 0.0
            h["day_change_pct"] = round((current_price - prev_close) / prev_close, 4) if prev_close else 0.0
        elif h.get("market") in {"sg_bond", "cash"}:
            # Savings bonds and cash held at face value
            mv_native = h.get("cost_basis", 0)
            mv_base = mv_native * fx_rate
            total_mv += mv_base
            h["current_price"] = None
            h["market_value"] = mv_native
            h["unrealized_pnl"] = 0.0
            h["unrealized_pnl_pct"] = 0.0
            h["day_change_pct"] = 0.0
            h["day_change"] = 0.0
        else:
            h["current_price"] = None
            h["market_value"] = None
            h["unrealized_pnl"] = None
            h["unrealized_pnl_pct"] = None
            h["day_change_pct"] = None
            h["day_change"] = None

        h["dividends_received"] = round(dividends_by_symbol.get(h["symbol"], 0.0), 2)

        mv_base_value = (h.get("market_value") or 0) * fx_rate
        by_market[h["market"]]["cost"] += cost_base
        by_market[h["market"]]["value"] += mv_base_value
        by_market[h["market"]]["count"] += 1
        by_currency[cur]["cost"] += cost_base
        by_currency[cur]["value"] += mv_base_value
        by_currency[cur]["count"] += 1

    total_mv = round(total_mv, 2)
    total_cost = round(total_cost, 2)
    total_unrealized = round(total_unrealized, 2)
    total_realized_base = round(total_realized, 2)
    total_divs_base = round(total_dividends, 2)
    pnl_pct = total_unrealized / total_cost if total_cost else 0.0
    day_pct = total_day_change / (total_mv - total_day_change) if (total_mv - total_day_change) else 0.0

    return {
        "total_cost_basis": total_cost,
        "total_market_value": total_mv,
        "total_unrealized_pnl": total_unrealized,
        "total_unrealized_pnl_pct": round(pnl_pct, 4),
        "total_realized_pnl": total_realized_base,
        "total_dividends": total_divs_base,
        "day_change": round(total_day_change, 2),
        "day_change_pct": round(day_pct, 4),
        "holdings_count": len(holdings),
        "positions_count": sum(1 for h in holdings if h["quantity"] > 0),
        "by_market": {k: {kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in by_market.items()},
        "by_currency": {k: {kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in by_currency.items()},
        "base_currency": base_currency,
    }


# ----------------------------- currency breakdown ----------------------------

def build_currency_breakdown(
    holdings: List[dict],
    roundtrips: List,
    transactions: List,
    dividends_by_symbol_ccy: Dict[str, Dict[str, float]],
    prices: Dict[str, dict],
    base_currency: str = "SGD",
    fx_rates: Optional[Dict[str, float]] = None,
    capital_in_by_ccy: Optional[Dict[str, float]] = None,
    total_capital_base: Optional[float] = None,
    fx_service=None,
) -> dict:
    """Build a per-currency P&L table.

    **Each row is shown in its NATIVE currency** (HKD row in HKD, etc.)
    except for the totals row which is converted to base_currency.

    Columns: Currency, Current Value, Current P&L (+Div),
             Closed P&L (+Div), Overall P&L (+Div).

    Args:
        dividends_by_symbol_ccy: nested dict symbol -> currency -> total
            dividends received in that currency. The function partitions
            these into "current position" (symbol still held) vs
            "closed position" (symbol fully sold).
    """
    fx = fx_rates or {}

    def to_base(amount: float, ccy: str) -> float:
        if ccy == base_currency:
            return amount
        rate = fx.get(ccy, 1.0)
        return amount * rate

    def _hist_rate(ccy: str, date_str: str) -> float:
        if ccy == base_currency:
            return 1.0
        if fx_service:
            return fx_service.get_historical_rate(ccy, base_currency, date_str)
        return fx.get(ccy, 1.0)

    # ----- aggregate raw per-currency values (native) -----
    cur_mv: Dict[str, float] = defaultdict(float)
    cur_cost: Dict[str, float] = defaultdict(float)
    cur_div: Dict[str, float] = defaultdict(float)
    closed_pnl: Dict[str, float] = defaultdict(float)
    closed_div: Dict[str, float] = defaultdict(float)
    capital_in: Dict[str, float] = defaultdict(float)
    day_chg: Dict[str, float] = defaultdict(float)

    # Capital deployed = sum of BUY net amounts (per currency, native)
    if capital_in_by_ccy is not None:
        capital_in.update(capital_in_by_ccy)
    else:
        for t in transactions:
            if t.side == "buy":
                capital_in[t.currency] += t.net_amount

    held_symbols = {h["symbol"] for h in holdings}
    # Compute cost in base currency using historical FX rates per lot
    cost_base_by_ccy: Dict[str, float] = defaultdict(float)
    for h in holdings:
        ccy = h.get("currency", "USD")
        market = h.get("market", "")
        cost = h.get("cost_basis", 0)
        cur_cost[ccy] += cost
        # Use historical rates per lot for cost in base currency
        lots = h.get("lots") or []
        if lots:
            for l in lots:
                cost_base_by_ccy[ccy] += l["cost_basis"] * _hist_rate(ccy, l["acquired"])
        else:
            cost_base_by_ccy[ccy] += cost * fx.get(ccy, 1.0)
        price_info = prices.get(h["symbol"], {})
        cur_px = price_info.get("price")
        if cur_px is not None and not (isinstance(cur_px, float) and math.isnan(cur_px)):
            cur_mv[ccy] += h["quantity"] * cur_px
        elif market in {"sg_bond", "cash"}:
            # Savings bonds and cash are held at face value — no market price
            cur_mv[ccy] += cost
        # Day change is already in the holding's native currency
        dc = h.get("day_change")
        if dc is not None and not (isinstance(dc, float) and math.isnan(dc)):
            day_chg[ccy] += dc

    # closed_pnl needs historical FX conversion per roundtrip (sell date)
    # Track both native and base-currency (per-roundtrip historical)
    closed_pnl_base_by_ccy: Dict[str, float] = defaultdict(float)
    for r in roundtrips:
        closed_pnl[r.currency] += r.pnl
        sell_iso = r.sell_date.isoformat() if hasattr(r.sell_date, "isoformat") else str(r.sell_date)
        closed_pnl_base_by_ccy[r.currency] += _hist_rate(r.currency, sell_iso) * r.pnl

    # Partiton dividends by symbol: open-position dividends vs closed-position
    for sym, by_ccy in dividends_by_symbol_ccy.items():
        for ccy, amt in by_ccy.items():
            if sym in held_symbols:
                cur_div[ccy] += amt
            else:
                closed_div[ccy] += amt

    # ----- build per-currency rows in NATIVE currency -----
    rows = []
    all_ccys = sorted(set(cur_mv) | set(cur_cost) | set(closed_pnl) | set(cur_div) | set(closed_div) | set(capital_in) | set(day_chg))
    for ccy in all_ccys:
        mv_native = cur_mv.get(ccy, 0)
        cost_native = cur_cost.get(ccy, 0)
        closed_native = closed_pnl.get(ccy, 0)
        cap_native = capital_in.get(ccy, 0)
        open_div_native = cur_div.get(ccy, 0)
        closed_div_native = closed_div.get(ccy, 0)
        day_native = day_chg.get(ccy, 0)

        current_pnl_native = mv_native - cost_native
        current_pnl_div_native = current_pnl_native + open_div_native
        closed_pnl_div_native = closed_native + closed_div_native
        overall_pnl_div_native = current_pnl_div_native + closed_pnl_div_native

        cap_for_pct = cap_native if cap_native else (cost_native if cost_native else 0)
        total_div_native = open_div_native + closed_div_native

        # P&L in base currency: use historical rate for cost, today's rate for value
        mv_base_hist = to_base(mv_native, ccy)
        cost_base_hist = cost_base_by_ccy.get(ccy, 0)
        current_pnl_div_base = mv_base_hist - cost_base_hist + to_base(open_div_native, ccy)
        # Use historical FX on sell date for closed PnL (not today's rate)
        closed_pnl_base = closed_pnl_base_by_ccy.get(ccy, to_base(closed_native, ccy))
        closed_pnl_div_base = closed_pnl_base + to_base(closed_div_native, ccy)
        overall_pnl_div_base = current_pnl_div_base + closed_pnl_div_base

        rows.append({
            "currency": ccy,
            "current_value": round(mv_native, 2),
            "current_value_pct": 0.0,
            "day_change": round(day_native, 2),
            "day_change_pct": round(_safe_div(day_native, mv_native - day_native), 4) if (mv_native - day_native) else 0.0,
            "current_pnl": round(current_pnl_native, 2),
            "current_pnl_div": round(current_pnl_div_native, 2),
            "current_pnl_div_pct": round(_safe_div(current_pnl_div_native, cap_for_pct), 4) if cap_for_pct else 0.0,
            "closed_pnl": round(closed_native, 2),
            "closed_pnl_div": round(closed_pnl_div_native, 2),
            "overall_pnl_div": round(overall_pnl_div_native, 2),
            "overall_pnl_div_pct": round(_safe_div(overall_pnl_div_native, cap_for_pct), 4) if cap_for_pct else 0.0,
            "current_div": round(open_div_native, 2),
            "closed_div": round(closed_div_native, 2),
            "total_div": round(total_div_native, 2),
            "current_value_base": round(mv_base_hist, 2),
            "current_pnl_div_base": round(current_pnl_div_base, 2),
            "current_pnl_base": round(current_pnl_div_base - to_base(open_div_native, ccy), 2),
            "closed_pnl_base": round(closed_pnl_base, 2),
            "closed_pnl_div_base": round(closed_pnl_div_base, 2),
            "overall_pnl_div_base": round(overall_pnl_div_base, 2),
            "current_div_base": round(to_base(open_div_native, ccy), 2),
            "closed_div_base": round(to_base(closed_div_native, ccy), 2),
            "total_div_base": round(to_base(total_div_native, ccy), 2),
            "capital_base": round(cost_base_hist, 2),
        })

    total_mv_base = sum(r["current_value_base"] for r in rows)
    for r in rows:
        r["current_value_pct"] = round(_safe_div(r["current_value_base"], total_mv_base), 4) if total_mv_base else 0.0

    total_capital_base = (
        total_capital_base if total_capital_base is not None
        else sum(r["capital_base"] for r in rows)
    )
    totals = {
        "currency": f"Total in {base_currency}",
        "current_value": round(total_mv_base, 2),
        "current_value_pct": 1.0,
        "day_change": round(sum(r["day_change"] for r in rows), 2),
        "day_change_pct": round(_safe_div(sum(r["day_change"] for r in rows), total_mv_base - sum(r["day_change"] for r in rows)), 4) if (total_mv_base - sum(r["day_change"] for r in rows)) else 0.0,
        "current_pnl": round(sum(r["current_pnl_div_base"] for r in rows) - sum(r["current_div_base"] for r in rows), 2),
        "current_pnl_div": round(sum(r["current_pnl_div_base"] for r in rows), 2),
        "current_pnl_div_pct": round(_safe_div(sum(r["current_pnl_div_base"] for r in rows), total_capital_base), 4) if total_capital_base else 0.0,
        "closed_pnl": round(sum(r["closed_pnl_base"] for r in rows), 2),
        "closed_pnl_div": round(sum(r["closed_pnl_div_base"] for r in rows), 2),
        "overall_pnl_div": round(sum(r["overall_pnl_div_base"] for r in rows), 2),
        "overall_pnl_div_pct": round(_safe_div(sum(r["overall_pnl_div_base"] for r in rows), total_capital_base), 4) if total_capital_base else 0.0,
        "current_div": round(sum(r["current_div_base"] for r in rows), 2),
        "closed_div": round(sum(r["closed_div_base"] for r in rows), 2),
        "total_div": round(sum(r["total_div_base"] for r in rows), 2),
        "capital": round(total_capital_base, 2),
    }

    # Strip only fields the frontend doesn't need (keep _base fields for SGD display)
    for r in rows:
        for k in ("capital_base",):
            r.pop(k, None)

    return {
        "rows": rows,
        "totals": totals,
        "base_currency": base_currency,
    }


# ----------------------------- TWR / XIRR -----------------------------------

def _annualised(years: float, total: float) -> float:
    if years <= 0 or total <= 0:
        return 0.0
    return total ** (1.0 / years) - 1.0


def compute_twr(
    capital_in_base: float,
    current_value_base: float,
    realised_base: float,
    dividends_base: float,
) -> float:
    """Simple total return on capital deployed.

    capital_in_base = sum of BUY net amounts converted to base.
    For a personal tracker with no top-ups, this is the correct
    "money-weighted" return denominator (XIRR handles the time dimension
    separately).
    """
    if capital_in_base <= 0:
        return 0.0
    return (current_value_base + realised_base + dividends_base) / capital_in_base - 1.0


def compute_xirr(
    transactions: List,
    current_value_base: float,
    base_currency: str = "SGD",
    fx_rates: Optional[Dict[str, float]] = None,
    fx_service=None,
) -> float:
    """XIRR via scipy.optimize.brentq on a cash-flow timeline.

    Cash flows: each buy = negative outflow, each sell = positive inflow,
    plus the final "today" value as a positive inflow. Returns 0 if not
    computable.

    If fx_service is provided, converts each cash flow at the historical rate
    on the transaction date. Otherwise uses today's fx_rates.
    """
    from datetime import date as _date
    from scipy.optimize import brentq

    fx = fx_rates or {}

    def to_base(amount: float, ccy: str, date) -> float:
        if ccy == base_currency:
            return amount
        if fx_service is not None and hasattr(fx_service, "get_historical_rate"):
            return amount * fx_service.get_historical_rate(ccy, base_currency, date.isoformat())
        return amount * fx.get(ccy, 1.0)

    if not transactions:
        return 0.0
    flows: list[tuple] = []
    for t in transactions:
        amt = t.net_amount
        if t.side == "buy":
            amt = -amt
        amt_base = to_base(amt, t.currency, t.date)
        flows.append((t.date, amt_base))
    if current_value_base > 0:
        flows.append((_date.today(), current_value_base))
    flows.sort(key=lambda x: x[0])
    if not flows or len(flows) < 2:
        return 0.0

    def npv(rate: float) -> float:
        from datetime import date as _d
        t0 = flows[0][0]
        total = 0.0
        for d, v in flows:
            years = (d - t0).days / 365.0
            if (1.0 + rate) <= 0 and years > 0:
                return float("inf")
            total += v / ((1.0 + rate) ** years)
        return total

    try:
        from scipy.optimize import brentq
    except ImportError:
        logger.warning("scipy not installed — XIRR disabled (return 0.0). Add scipy to requirements.txt to enable.")
        return 0.0
    try:
        return brentq(npv, -0.99, 10.0, maxiter=200, xtol=1e-6)
    except Exception:
        return 0.0
