"""FX rate service backed by yfinance.

Quotes pairs as `<FROM><TO>=X` (e.g. USDSGD=X, HKDSGD=X). Caches in memory
with a TTL.
"""
from __future__ import annotations

import logging
import time
from typing import Dict, Optional

import pandas as pd

logger = logging.getLogger(__name__)

try:
    import yfinance as yf
    _HAS_YFINANCE = True
except ImportError:  # pragma: no cover
    _HAS_YFINANCE = False


# Reasonable static fallback rates (per 1 unit of FROM, in TO).
# Used only when yfinance is unreachable so the dashboard never breaks.
_FALLBACK_RATES = {
    # TO = USD (per 1 FROM)
    ("USD", "USD"): 1.0,
    ("SGD", "USD"): 0.74,
    ("HKD", "USD"): 0.128,
    ("GBP", "USD"): 1.27,
    ("CNY", "USD"): 0.14,
    # TO = SGD
    ("SGD", "SGD"): 1.0,
    ("USD", "SGD"): 1.0 / 0.74,
    ("HKD", "SGD"): 0.128 / 0.74,
    ("GBP", "SGD"): 1.27 / 0.74,
    ("CNY", "SGD"): 0.14 / 0.74,
    # TO = HKD
    ("USD", "HKD"): 1.0 / 0.128,
    ("SGD", "HKD"): 0.74 / 0.128,
    ("GBP", "HKD"): 1.27 / 0.128,
    ("CNY", "HKD"): 0.14 / 0.128,
}


class FxService:
    def __init__(self, ttl_seconds: int = 3600, db=None):
        self.ttl = ttl_seconds
        self._cache: Dict[str, tuple] = {}  # pair -> (rate, ts)
        self._historical_cache: Dict[tuple, float] = {}  # (pair, date) -> rate
        self._db = db  # optional Database instance for persistent FX cache

    def get(self, from_ccy: str, to_ccy: str) -> float:
        from_ccy = from_ccy.upper()
        to_ccy = to_ccy.upper()
        if from_ccy == to_ccy:
            return 1.0
        key = f"{from_ccy}{to_ccy}=X"
        now = time.time()
        cached = self._cache.get(key)
        if cached and (now - cached[1]) < self.ttl:
            return cached[0]
        rate = self._fetch(key)
        if rate is None:
            # Try the inverse
            inv_key = f"{to_ccy}{from_ccy}=X"
            inv = self._fetch(inv_key)
            if inv:
                rate = 1.0 / inv
        if rate is None:
            rate = _FALLBACK_RATES.get((from_ccy, to_ccy))
        if rate is None:
            # Last-ditch: convert via USD
            via_usd_from = _FALLBACK_RATES.get((from_ccy, "USD"), 1.0)
            via_usd_to = _FALLBACK_RATES.get((to_ccy, "USD"), 1.0)
            rate = via_usd_from / via_usd_to
            logger.warning("Using triangulated FX for %s->%s: %s", from_ccy, to_ccy, rate)
        self._cache[key] = (rate, now)
        return rate

    def _fetch(self, pair: str) -> Optional[float]:
        if not _HAS_YFINANCE:
            return None
        try:
            t = yf.Ticker(pair)
            fast = getattr(t, "fast_info", None)
            if fast is not None:
                try:
                    p = fast.get("last_price") or fast.get("regular_market_price")
                    if p:
                        return float(p)
                except Exception:
                    pass
            hist = t.history(period="5d", interval="1d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception as e:
            logger.debug("FX fetch failed for %s: %s", pair, e)
        return None

    def rates_to(self, to_ccy: str, from_ccys: list[str]) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for c in from_ccys:
            out[c] = self.get(c, to_ccy)
        return out

    def get_historical_rate(self, from_ccy: str, to_ccy: str, date_str: str) -> float:
        """Fetch the FX rate for a specific date (YYYY-MM-DD).

        Checks SQLite db first (persistent cache), then in-memory cache,
        then fetches from yfinance, then falls back to static rates.
        """
        from_ccy = from_ccy.upper()
        to_ccy = to_ccy.upper()
        if from_ccy == to_ccy:
            return 1.0

        pair = f"{from_ccy}{to_ccy}=X"
        cache_key = (pair, date_str)

        #1. Check in-memory cache first (fastest)
        cached = self._historical_cache.get(cache_key)
        if cached is not None:
            return cached

        # 2. Check SQLite persistent cache
        if self._db is not None:
            try:
                db_rate = self._db.load_fx_rate(from_ccy, to_ccy, date_str)
                if db_rate is not None:
                    self._historical_cache[cache_key] = db_rate
                    return db_rate
            except Exception as e:
                logger.debug("db fx lookup failed: %s", e)

        # 3. Fetch from yfinance
        rate = self._fetch_historical(pair, date_str)
        if rate is None:
            inv_pair = f"{to_ccy}{from_ccy}=X"
            inv = self._fetch_historical(inv_pair, date_str)
            if inv:
                rate = 1.0 / inv

        # 4. Fallback to static rates
        if rate is None:
            rate = _FALLBACK_RATES.get((from_ccy, to_ccy))
        if rate is None:
            via_usd_from = _FALLBACK_RATES.get((from_ccy, "USD"), 1.0)
            via_usd_to = _FALLBACK_RATES.get((to_ccy, "USD"), 1.0)
            rate = via_usd_from / via_usd_to
            logger.warning("Using fallback FX for historical %s->%s on %s", from_ccy, to_ccy, date_str)

        # 5. Persist to SQLite and in-memory cache
        self._historical_cache[cache_key] = rate
        if self._db is not None:
            try:
                self._db.save_fx_rate(from_ccy, to_ccy, date_str, rate)
            except Exception as e:
                logger.debug("db fx save failed: %s", e)

        return rate

    def _fetch_historical(self, pair: str, date_str: str) -> Optional[float]:
        if not _HAS_YFINANCE:
            return None
        try:
            t = yf.Ticker(pair)
            dt = pd.to_datetime(date_str)
            start = (dt - pd.Timedelta(days=5)).strftime("%Y-%m-%d")
            end = (dt + pd.Timedelta(days=5)).strftime("%Y-%m-%d")
            hist = t.history(start=start, end=end, interval="1d", auto_adjust=False)
            if hist.empty:
                return None
            target_ts = pd.Timestamp(dt, tz=hist.index.tz or "UTC")
            if target_ts not in hist.index:
                idx = hist.index.searchsorted(target_ts)
                if idx >= len(hist):
                    idx = len(hist) - 1
                target_ts = hist.index[idx]
            return float(hist.loc[target_ts, "Close"])
        except Exception as e:
            logger.debug("FX historical fetch failed for %s @ %s: %s", pair, date_str, e)
            return None
