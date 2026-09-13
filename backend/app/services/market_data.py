"""Market data service backed by yfinance.

Reuses the symbol-conversion logic from Vibe-Trading (yfinance_loader.py).
Includes a small TTL cache to avoid hammering Yahoo on every dashboard refresh.
"""
from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

try:
    import yfinance as yf
    _HAS_YFINANCE = True
except ImportError:  # pragma: no cover
    _HAS_YFINANCE = False


def _nan_none(v: object) -> object:
    """Convert NaN floats to None to prevent null propagation in JSON."""
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


@dataclass
class Quote:
    symbol: str
    yahoo_symbol: str
    market: str
    currency: str
    price: Optional[float] = None
    previous_close: Optional[float] = None
    change_pct: Optional[float] = None
    name: Optional[str] = None
    as_of: Optional[float] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "yahoo_symbol": self.yahoo_symbol,
            "market": self.market,
            "currency": self.currency,
            "price": self.price,
            "previous_close": self.previous_close,
            "change_pct": self.change_pct,
            "name": self.name,
            "as_of": self.as_of,
            "error": self.error,
        }


class MarketDataService:
    """Lightweight yfinance wrapper with TTL cache."""

    def __init__(self, ttl_seconds: int = 300, max_workers: int = 6,
                 div_cache_seconds: int = 86400):
        self.ttl = ttl_seconds
        self.max_workers = max_workers
        self._cache: Dict[str, Quote] = {}
        # Profile-name lookups are separate from yf.download(), which only
        # returns market data. Keep successful and empty lookups in memory so
        # a forced price refresh does not issue the same info request again.
        self._name_cache: Dict[str, Tuple[float, Optional[str]]] = {}
        # Cache for "this yahoo_symbol has no dividend history" (negative cache)
        # and successful empty results. TTL is long (1 day default) since
        # dividend history rarely changes.
        self._div_cache_seconds = div_cache_seconds
        self._div_cache: Dict[str, tuple] = {}  # symbol -> (timestamp, result)

    @staticmethod
    def _quote_for_request(quote: Quote, request: dict) -> Quote:
        """Return shared quote data with the current user's symbol metadata."""
        return Quote(
            symbol=request.get("symbol", quote.symbol),
            yahoo_symbol=request.get("yahoo_symbol") or quote.yahoo_symbol,
            market=request.get("market", quote.market),
            currency=request.get("currency", quote.currency),
            price=quote.price,
            previous_close=quote.previous_close,
            change_pct=quote.change_pct,
            name=quote.name,
            as_of=quote.as_of,
            error=quote.error,
        )

    # ----- single quote -----

    def get_quote(self, symbol: str, yahoo_symbol: str, market: str,
                  currency: str, *, use_cache: bool = True) -> Quote:
        if not yahoo_symbol:
            return Quote(symbol=symbol, yahoo_symbol=yahoo_symbol, market=market,
                         currency=currency, error="no_yahoo_symbol")
        if not _HAS_YFINANCE:
            return Quote(symbol=symbol, yahoo_symbol=yahoo_symbol, market=market,
                         currency=currency, error="yfinance_not_installed")

        cache_key = yahoo_symbol
        now = time.time()
        if use_cache and cache_key in self._cache:
            q = self._cache[cache_key]
            if q.as_of and (now - q.as_of) < self.ttl:
                return self._quote_for_request(q, {
                    "symbol": symbol,
                    "yahoo_symbol": yahoo_symbol,
                    "market": market,
                    "currency": currency,
                })

        try:
            t = yf.Ticker(yahoo_symbol)
            fast = getattr(t, "fast_info", None)
            price = None
            prev = None
            if fast is not None:
                try:
                    price = _nan_none(fast.get("last_price")) or _nan_none(fast.get("regular_market_price"))
                    prev = _nan_none(fast.get("previous_close")) or _nan_none(fast.get("regular_market_previous_close"))
                except Exception:
                    pass

            # Second fallback: t.info (e.g. regularMarketPrice, previousClose)
            # Some LSE-listed ETFs like IWDA.L don't populate fast_info
            # correctly but do expose prices in t.info.
            info = {}
            try:
                info = t.info or {}
            except Exception:
                pass
            if price is None:
                price = _nan_none(info.get("regularMarketPrice")) or _nan_none(info.get("currentPrice"))
            if prev is None:
                prev = _nan_none(info.get("previousClose")) or _nan_none(info.get("regularMarketPreviousClose"))

            # Third fallback: yfinance history. Some symbols (e.g. IWDA.L)
            # have NaN for today's close but a valid close earlier in the
            # window — pick the last non-NaN value instead of giving up.
            if price is None or prev is None:
                try:
                    hist = t.history(period="1mo", auto_adjust=False)
                    closes = hist["Close"].dropna() if not hist.empty else None
                    if closes is not None and len(closes) > 0:
                        if price is None:
                            price = _nan_none(float(closes.iloc[-1]))
                        if prev is None:
                            if len(closes) >= 2:
                                prev = _nan_none(float(closes.iloc[-2]))
                            else:
                                # Only 1 valid close — use it as prev so
                                # change_pct is computable as 0.
                                prev = _nan_none(float(closes.iloc[-1]))
                except Exception:
                    pass

            if price is None:
                q = Quote(symbol=symbol, yahoo_symbol=yahoo_symbol, market=market,
                          currency=currency, error="no_price",
                          name=info.get("longName") or info.get("shortName"))
            else:
                change_pct = ((price - prev) / prev) if prev else None
                q = Quote(
                    symbol=symbol,
                    yahoo_symbol=yahoo_symbol,
                    market=market,
                    currency=info.get("currency", currency) or currency,
                    price=float(price),
                    previous_close=float(prev) if prev else None,
                    change_pct=change_pct,
                    name=info.get("longName") or info.get("shortName"),
                    as_of=now,
                )
        except Exception as e:
            logger.warning("yfinance quote failed for %s: %s", yahoo_symbol, e)
            q = Quote(symbol=symbol, yahoo_symbol=yahoo_symbol, market=market,
                      currency=currency, error=str(e))
        self._cache[cache_key] = q
        return q

    # ----- batched -----

    def _fill_missing_names(self, out: Dict[str, Quote], requests: List[dict]) -> None:
        """Fill names for priced quotes that yf.download() cannot provide.

        ``yf.download`` returns OHLCV data only. Profile names require a
        separate ``Ticker.info`` request, so only successful priced quotes
        with a missing name are looked up here. This avoids polling symbols
        that already failed to return a price (for example delisted tickers).
        """
        if not _HAS_YFINANCE:
            return

        now = time.time()
        targets: Dict[str, List[str]] = {}
        for r in requests:
            yahoo_symbol = r.get("yahoo_symbol") or r.get("symbol") or ""
            sym = r.get("symbol") or ""
            quote = out.get(sym)
            if not yahoo_symbol or quote is None or quote.price is None or quote.name:
                continue
            targets.setdefault(yahoo_symbol, []).append(sym)

        if not targets:
            return

        missing_lookup: List[str] = []
        for yahoo_symbol in targets:
            cached = self._name_cache.get(yahoo_symbol)
            if cached and (now - cached[0]) < 86400:
                name = cached[1]
                if name:
                    for sym in targets[yahoo_symbol]:
                        out[sym].name = name
                        self._cache[yahoo_symbol] = out[sym]
                continue
            missing_lookup.append(yahoo_symbol)

        def lookup(yahoo_symbol: str) -> Tuple[str, Optional[str]]:
            try:
                info = yf.Ticker(yahoo_symbol).info or {}
                name = info.get("longName") or info.get("shortName") or None
                return yahoo_symbol, name
            except Exception as e:
                logger.debug("yfinance name lookup failed for %s: %s", yahoo_symbol, e)
                return yahoo_symbol, None

        if missing_lookup:
            workers = min(self.max_workers, len(missing_lookup))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = [executor.submit(lookup, yahoo_symbol) for yahoo_symbol in missing_lookup]
                for future in as_completed(futures):
                    yahoo_symbol, name = future.result()
                    self._name_cache[yahoo_symbol] = (now, name)
                    if name:
                        for sym in targets[yahoo_symbol]:
                            out[sym].name = name
                            self._cache[yahoo_symbol] = out[sym]

    def get_quotes(self, requests: List[dict], *, use_cache: bool = True) -> Dict[str, Quote]:
        """Fetch many quotes in one batched yfinance request.

        Each request: {symbol, yahoo_symbol, market, currency}
        """
        out: Dict[str, Quote] = {}
        for r in requests:
            sym = r["symbol"]
            cache_key = r.get("yahoo_symbol") or sym
            if use_cache and cache_key in self._cache:
                q = self._cache[cache_key]
                if q.as_of and (time.time() - q.as_of) < self.ttl:
                    out[sym] = self._quote_for_request(q, r)
        missing = [r for r in requests if r["symbol"] not in out]
        if not missing:
            self._fill_missing_names(out, requests)
            return out

        if not _HAS_YFINANCE:
            for r in missing:
                out[r["symbol"]] = self.get_quote(
                    r["symbol"], r.get("yahoo_symbol", ""), r.get("market", ""),
                    r.get("currency", "USD"), use_cache=use_cache,
                )
            return out

        now = time.time()
        by_yahoo: Dict[str, List[dict]] = {}
        for r in missing:
            yahoo_symbol = r.get("yahoo_symbol") or ""
            if yahoo_symbol:
                by_yahoo.setdefault(yahoo_symbol, []).append(r)

        close_data = pd.DataFrame()
        yahoo_symbols = sorted(by_yahoo)
        if yahoo_symbols:
            try:
                # One request for all missing symbols. Five trading days provides
                # both the latest close and a previous close for daily movement.
                data = yf.download(
                    tickers=yahoo_symbols,
                    period="5d",
                    interval="1d",
                    auto_adjust=False,
                    progress=False,
                    threads=True,
                    group_by="column",
                )
                if isinstance(data, pd.DataFrame) and not data.empty:
                    if isinstance(data.columns, pd.MultiIndex):
                        level0 = data.columns.get_level_values(0)
                        level1 = data.columns.get_level_values(1)
                        if "Close" in level0:
                            close_data = data["Close"]
                        elif "Close" in level1:
                            close_data = data.xs("Close", level=1, axis=1)
                    elif "Close" in data.columns:
                        close_data = data[["Close"]]
                        if len(yahoo_symbols) == 1:
                            close_data.columns = yahoo_symbols
            except Exception as e:
                logger.warning("batched yfinance quote fetch failed: %s", e)

        for yahoo_symbol, symbol_requests in by_yahoo.items():
            closes = pd.Series(dtype=float)
            if isinstance(close_data, pd.DataFrame) and yahoo_symbol in close_data.columns:
                closes = pd.to_numeric(close_data[yahoo_symbol], errors="coerce").dropna()
            elif isinstance(close_data, pd.Series) and len(yahoo_symbols) == 1:
                closes = pd.to_numeric(close_data, errors="coerce").dropna()

            price = float(closes.iloc[-1]) if len(closes) else None
            previous_close = float(closes.iloc[-2]) if len(closes) >= 2 else price
            change_pct = ((price - previous_close) / previous_close) if price is not None and previous_close else None

            for r in symbol_requests:
                sym = r["symbol"]
                if price is None:
                    q = Quote(
                        symbol=sym,
                        yahoo_symbol=yahoo_symbol,
                        market=r.get("market", ""),
                        currency=r.get("currency", "USD"),
                        as_of=now,
                        error="no_price",
                    )
                else:
                    q = Quote(
                        symbol=sym,
                        yahoo_symbol=yahoo_symbol,
                        market=r.get("market", ""),
                        currency=r.get("currency", "USD"),
                        price=price,
                        previous_close=previous_close,
                        change_pct=change_pct,
                        as_of=now,
                    )
                self._cache[yahoo_symbol] = q
                out[sym] = q

        # Requests without a resolvable Yahoo symbol still receive the same
        # explicit error shape as the single-quote path.
        for r in missing:
            if r["symbol"] not in out:
                out[r["symbol"]] = Quote(
                    symbol=r["symbol"],
                    yahoo_symbol=r.get("yahoo_symbol", ""),
                    market=r.get("market", ""),
                    currency=r.get("currency", "USD"),
                    as_of=now,
                    error="no_yahoo_symbol",
                )
        self._fill_missing_names(out, requests)
        return out

    # ----- dividends -----

    def get_dividends(self, yahoo_symbol: str) -> Optional[pd.Series]:
        if not yahoo_symbol or not _HAS_YFINANCE:
            return None
        # TTL cache — saves repeat yfinance calls within the same process
        now = time.time()
        if yahoo_symbol in self._div_cache:
            ts, cached = self._div_cache[yahoo_symbol]
            if (now - ts) < self._div_cache_seconds:
                return cached
        try:
            t = yf.Ticker(yahoo_symbol)
            d = t.dividends
            if d is None or d.empty:
                result = None
            else:
                result = d
            self._div_cache[yahoo_symbol] = (now, result)
            return result
        except Exception as e:
            logger.warning("yfinance dividends failed for %s: %s", yahoo_symbol, e)
            return None

    # ----- history -----

    def get_history(self, yahoo_symbol: str, period: str = "1y",
                    interval: str = "1d") -> pd.DataFrame:
        if not yahoo_symbol or not _HAS_YFINANCE:
            return pd.DataFrame()
        try:
            t = yf.Ticker(yahoo_symbol)
            df = t.history(period=period, interval=interval, auto_adjust=False)
            return df
        except Exception as e:
            logger.warning("yfinance history failed for %s: %s", yahoo_symbol, e)
            return pd.DataFrame()

    # ----- 7-day price change -----

    def get_7d_change(self, yahoo_symbol: str) -> Optional[float]:
        """Return the percentage change in price over the last 7 days.

        Uses a longer TTL (1 hour) since the "7d" window doesn't change
        minute-to-minute. Returns None if the data is unavailable.
        """
        return self.get_7d_changes([yahoo_symbol]).get(yahoo_symbol)

    def get_7d_changes(self, yahoo_symbols: List[str]) -> Dict[str, Optional[float]]:
        """Fetch 7-day changes for many symbols in one yfinance request."""
        if not _HAS_YFINANCE:
            return {symbol: None for symbol in yahoo_symbols if symbol}

        now = time.time()
        result: Dict[str, Optional[float]] = {}
        missing: List[str] = []
        for symbol in sorted(set(filter(None, yahoo_symbols))):
            cache_key = f"7d:{symbol}"
            entry = self._cache.get(cache_key)
            # Keep failed/delisted symbols quiet longer than successful
            # movers; this cache is intentionally in-memory because it is a
            # derived display metric rather than an authoritative price.
            cache_ttl = 86400 if isinstance(entry, dict) and entry.get("pct") is None else 3600
            if isinstance(entry, dict) and (now - (entry.get("as_of") or 0)) < cache_ttl:
                result[symbol] = entry.get("pct")
            else:
                missing.append(symbol)
        if not missing:
            return result

        close_data = pd.DataFrame()
        try:
            # Ten trading days gives a stable fallback around weekends and
            # market holidays while keeping this request small.
            data = yf.download(
                tickers=missing,
                period="10d",
                interval="1d",
                auto_adjust=False,
                progress=False,
                threads=True,
                group_by="column",
            )
            if isinstance(data, pd.DataFrame) and not data.empty:
                if isinstance(data.columns, pd.MultiIndex):
                    level0 = data.columns.get_level_values(0)
                    level1 = data.columns.get_level_values(1)
                    if "Close" in level0:
                        close_data = data["Close"]
                    elif "Close" in level1:
                        close_data = data.xs("Close", level=1, axis=1)
                elif "Close" in data.columns:
                    close_data = data[["Close"]]
                    if len(missing) == 1:
                        close_data.columns = missing
        except Exception as e:
            logger.warning("batched yfinance 7d fetch failed: %s", e)

        for symbol in missing:
            if isinstance(close_data, pd.DataFrame) and symbol in close_data.columns:
                closes = pd.to_numeric(close_data[symbol], errors="coerce").dropna()
            elif isinstance(close_data, pd.Series) and len(missing) == 1:
                closes = pd.to_numeric(close_data, errors="coerce").dropna()
            else:
                closes = pd.Series(dtype=float)

            pct: Optional[float] = None
            if len(closes) >= 2:
                current = float(closes.iloc[-1])
                baseline = float(closes.iloc[max(0, len(closes) - 7)])
                if baseline > 0:
                    pct = (current - baseline) / baseline
            self._cache[f"7d:{symbol}"] = {"pct": pct, "as_of": now}
            result[symbol] = pct
        return result
