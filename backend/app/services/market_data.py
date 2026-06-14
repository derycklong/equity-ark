"""Market data service backed by yfinance.

Reuses the symbol-conversion logic from Vibe-Trading (yfinance_loader.py).
Includes a small TTL cache to avoid hammering Yahoo on every dashboard refresh.
"""
from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Dict, List, Optional

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
        self._cache: Dict[str, Quote] = {}
        # Cache for "this yahoo_symbol has no dividend history" (negative cache)
        # and successful empty results. TTL is long (1 day default) since
        # dividend history rarely changes.
        self._div_cache_seconds = div_cache_seconds
        self._div_cache: Dict[str, tuple] = {}  # symbol -> (timestamp, result)
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

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
                return q

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

    def get_quotes(self, requests: List[dict], *, use_cache: bool = True) -> Dict[str, Quote]:
        """Fetch many quotes in parallel.

        Each request: {symbol, yahoo_symbol, market, currency}
        """
        out: Dict[str, Quote] = {}
        for r in requests:
            sym = r["symbol"]
            cache_key = r.get("yahoo_symbol") or sym
            if use_cache and cache_key in self._cache:
                q = self._cache[cache_key]
                if q.as_of and (time.time() - q.as_of) < self.ttl:
                    out[sym] = q
        missing = [r for r in requests if r["symbol"] not in out]
        if missing:
            futures = {
                self._executor.submit(
                    self.get_quote,
                    r["symbol"], r.get("yahoo_symbol", ""), r.get("market", ""),
                    r.get("currency", "USD"), use_cache=use_cache,
                ): r["symbol"]
                for r in missing
            }
            for f in futures:
                out[futures[f]] = f.result()
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
        if not yahoo_symbol or not _HAS_YFINANCE:
            return None
        cache_key = f"7d:{yahoo_symbol}"
        now = time.time()
        if cache_key in self._cache:
            entry = self._cache[cache_key]
            ts = entry.get("as_of") or 0
            if (now - ts) < 3600:
                return entry.get("pct")
        try:
            t = yf.Ticker(yahoo_symbol)
            # 10d window so we have a fallback if 7d is on a holiday
            hist = t.history(period="10d", auto_adjust=False)
            if hist is None or hist.empty or len(hist) < 2:
                self._cache[cache_key] = {"pct": None, "as_of": now}
                return None
            closes = hist["Close"].dropna()
            current = float(closes.iloc[-1])
            # Look back to find the closest trading day ~7 days ago
            target_idx = max(0, len(closes) - 7)
            baseline = float(closes.iloc[target_idx])
            if baseline <= 0:
                pct = None
            else:
                pct = (current - baseline) / baseline
            self._cache[cache_key] = {"pct": pct, "as_of": now}
            return pct
        except Exception as e:
            logger.warning("yfinance 7d change failed for %s: %s", yahoo_symbol, e)
            return None
