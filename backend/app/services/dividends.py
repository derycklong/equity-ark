"""Dividend tracking service.

For each open holding, fetches the dividend history from yfinance, intersects
it with the period during which the user actually held the symbol, and
estimates the income they would have received.

Withholding tax is applied based on the market (exchange) of the stock.
US stocks default to 15% (Singapore treaty rate); this can be overridden
via the DIVIDEND_WITHHOLDING dict.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Dict, List, Optional

import pandas as pd

from .csv_parser import RawTransaction
from .market_data import MarketDataService

logger = logging.getLogger(__name__)

# Withholding tax rates by market (fraction of gross dividend withheld).
# US: 15% under SG-US treaty (with W-8BEN); 30% without.
# CN (China A-shares via Stock Connect): 10%.
# All others: 0% (HK, SG, UK, bonds, cash).
# Adjust these rates for your residency/treaty status.
DIVIDEND_WITHHOLDING: Dict[str, float] = {
    "us": 0.30,
    "cn": 0.10,
}


def _shares_held_curve(transactions: List[RawTransaction], sym: str) -> pd.Series:
    """Build a per-event cumulative share count series for a single symbol."""
    relevant = [t for t in transactions if t.symbol.upper() == sym]
    relevant.sort(key=lambda t: t.date)
    if not relevant:
        return pd.Series(dtype=float)
    rows = []
    for t in relevant:
        delta = t.quantity if t.side == "buy" else -t.quantity
        rows.append({"date": pd.Timestamp(t.date), "shares": delta})
    df = pd.DataFrame(rows).set_index("date")
    return df["shares"].cumsum()


def estimate_received_dividends(
    transactions: List[RawTransaction],
    symbol: str,
    market: str,
    currency: str,
    market_data: MarketDataService,
    yahoo_symbol: Optional[str] = None,
) -> List[dict]:
    """Return the list of dividend events the user would have received.

    For each dividend ex-date in yfinance, snapshot the user's shares held
    *up to* that ex-date (FIFO approximation) and multiply by amount/share.

    Args:
        yahoo_symbol: pre-resolved yfinance ticker (e.g. "Z74.SI"). If None,
            we re-resolve from the symbol, which is unreliable when the
            exchange is unknown (see resolve_symbol for edge cases).
    """
    res_symbols = {t.symbol.upper() for t in transactions}
    if symbol.upper() not in res_symbols:
        return []
    if market in {"sg_bond", "cash", "other"}:
        return []
    if not yahoo_symbol:
        from .csv_parser import resolve_symbol
        yahoo_symbol = resolve_symbol(symbol, "").yahoo_symbol
    if not yahoo_symbol:
        return []

    divs: Optional[pd.Series] = market_data.get_dividends(yahoo_symbol)
    if divs is None or divs.empty:
        return []

    # Build holdings curve
    held = _shares_held_curve(transactions, symbol)
    if held.empty:
        return []

    # yfinance dividends index is tz-aware (UTC)
    try:
        divs.index = divs.index.tz_convert(None)
    except Exception:
        try:
            divs.index = divs.index.tz_localize(None)
        except Exception:
            pass

    # Fetch the company name once (used for every event of this symbol)
    company_name: Optional[str] = None
    try:
        q = market_data.get_quote(
            symbol=symbol.upper(),
            yahoo_symbol=yahoo_symbol,
            market=market,
            currency=currency,
        )
        if q and getattr(q, "name", None):
            company_name = q.name
    except Exception:
        company_name = None

    events: List[dict] = []
    withholding_rate = DIVIDEND_WITHHOLDING.get(market, 0.0)
    for ex_ts, amt in divs.items():
        ex_date = ex_ts.date() if hasattr(ex_ts, "date") else ex_ts
        # shares held just before ex-date
        prior = held[held.index <= pd.Timestamp(ex_date)]
        shares = float(prior.iloc[-1]) if not prior.empty else 0.0
        if shares <= 0:
            continue
        total_gross = round(shares * float(amt), 4)
        total_net = round(total_gross * (1 - withholding_rate), 4)
        events.append({
            "symbol": symbol.upper(),
            "yahoo_symbol": yahoo_symbol,
            "ex_date": ex_date.isoformat() if hasattr(ex_date, "isoformat") else str(ex_date),
            "amount_per_share": round(float(amt), 6),
            "shares_at_ex": round(shares, 4),
            "total_received": total_net,
            "currency": currency,
            "name": company_name,
            "withholding_rate": withholding_rate,
            "total_gross": total_gross,
        })
    return events


def has_dividend_history(
    market: str,
    market_data: MarketDataService,
    yahoo_symbol: Optional[str],
) -> bool:
    """Check if yfinance has any dividend history for this symbol.

    Returns True if yfinance returned at least one dividend ex-date
    (regardless of whether the user held it at the time), False if
    yfinance returned no data (delisted symbol, no-div ETF, etc.).

    Use this to populate the negative cache — only mark "no dividends"
    when yfinance itself has nothing, not when the user simply didn't
    hold shares at the right ex-date.
    """
    if not yahoo_symbol or market in {"sg_bond", "cash", "other"}:
        return False
    divs = market_data.get_dividends(yahoo_symbol)
    return divs is not None and not divs.empty


def aggregate_dividends(events: List[dict], holdings: List[dict]) -> dict:
    """Build a summary block with totals, by-symbol breakdown, and by-year.

    Native per-currency totals are kept separate (do NOT mix SGD with USD).
    The base-currency total (`total_received_base`) and base-currency by-year
    (`by_year_base`) are filled in by `store.get_dividends` using FxService.
    """
    by_symbol_total: Dict[str, float] = defaultdict(float)
    by_symbol_count: Dict[str, int] = defaultdict(int)
    by_symbol_ccy: Dict[str, str] = {}
    by_symbol_name: Dict[str, str] = {}
    by_year: Dict[str, float] = defaultdict(float)
    by_year_by_ccy: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for e in events:
        sym = e["symbol"]
        ccy = e.get("currency", "")
        amt = e.get("total_received", 0) or 0
        by_symbol_total[sym] += amt
        by_symbol_count[sym] += 1
        by_symbol_ccy[sym] = ccy
        nm = e.get("name")
        if nm and not by_symbol_name.get(sym):
            by_symbol_name[sym] = nm
        try:
            y = e["ex_date"][:4]
        except Exception:
            y = "unknown"
        by_year[y] += amt
        by_year_by_ccy[y][ccy] += amt
    by_symbol = [
        {
            "symbol": s,
            "total": round(t, 2),
            "events": by_symbol_count[s],
            "currency": by_symbol_ccy.get(s, ""),
            "name": by_symbol_name.get(s),
        }
        for s, t in sorted(by_symbol_total.items(), key=lambda x: -x[1])
    ]
    return {
        "total_received": round(sum(by_symbol_total.values()), 2),
        "events_count": len(events),
        "by_symbol": by_symbol,
        "by_year": {y: round(v, 2) for y, v in sorted(by_year.items())},
        "by_year_by_ccy": {
            y: {c: round(v, 2) for c, v in sorted(d.items())}
            for y, d in sorted(by_year_by_ccy.items())
        },
    }


def dividends_to_holdings_map(events: List[dict]) -> Dict[str, float]:
    out: Dict[str, float] = defaultdict(float)
    for e in events:
        out[e["symbol"]] += e["total_received"]
    return dict(out)
