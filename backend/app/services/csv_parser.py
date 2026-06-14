"""CSV transaction parser and symbol resolver.

Adapted from Vibe-Trading's trade_journal_parsers.py but tailored for the
vibe-portfolio CSV format produced by broker export tools (Trading 212, Tiger,
Futu, etc.) — encoded column header `Sell (-1) Buy (1) Fees (0)`, and a mix of
USX / HKEX / LSE / SGX / SSB exchanges.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ----------------------------- exchange / market -----------------------------

@dataclass(frozen=True)
class SymbolResolution:
    market: str            # us | hk | uk | sg | cn | fund | cash | other
    yahoo_symbol: str      # e.g. BABA, 0986.HK, IWDA.L, D05.SI
    display_name: str = ""


# Singapore-listed common stocks (most SGX tickers are 2-4 letter alpha codes)
_SG_BLACKLIST_PRICE_ONLY = {
    # Items in the user's CSV that look like tickers but are actually
    # Singapore Government Securities (SSB) bond certificates.
    # These are listed on SSB (Singapore Savings Bonds), pay fixed coupons,
    # and are not tradeable on SGX. Track at face value only.
}


def _is_4digit_hk(code: str) -> bool:
    return bool(re.fullmatch(r"\d{3,5}", code))


def _is_6digit_cn(code: str) -> bool:
    return bool(re.fullmatch(r"\d{6}", code))


def resolve_symbol(symbol: str, exchange: str) -> SymbolResolution:
    """Map a (symbol, exchange) pair from the CSV to a yfinance symbol.

    Returns a SymbolResolution with the market bucket and a yfinance-compatible
    ticker.
    """
    raw = symbol.strip().upper()
    ex = (exchange or "").strip().upper()

    if not raw:
        return SymbolResolution(market="other", yahoo_symbol="")

    # Cash equivalent or special: handle before exchange routing
    if raw in {"USD", "HKD", "SGD", "USDC", "USDT"}:
        return SymbolResolution(market="cash", yahoo_symbol=raw)

    # SSB Singapore Savings Bonds
    if ex == "SSB" or raw.startswith("GX") or raw.startswith("IN"):
        return SymbolResolution(market="sg_bond", yahoo_symbol=raw, display_name=raw)

    # Mutual funds — no yfinance symbol, tracked manually
    if ex == "FUND":
        return SymbolResolution(market="fund", yahoo_symbol="", display_name=raw)

    if ex == "HKEX":
        digits = raw.zfill(4)
        return SymbolResolution(market="hk", yahoo_symbol=f"{digits}.HK")

    if ex == "LSE":
        # All LSE tickers use .L suffix in yfinance (some ETFs use LSE.L)
        return SymbolResolution(market="uk", yahoo_symbol=f"{raw}.L")

    if ex == "SGX":
        return SymbolResolution(market="sg", yahoo_symbol=f"{raw}.SI")

    if ex == "SH" or ex == "SZ" or ex == "SSE" or ex == "SZSE":
        suffix = ".SS" if ex in {"SH", "SSE"} else ".SZ"
        if _is_6digit_cn(raw):
            return SymbolResolution(market="cn", yahoo_symbol=f"{raw}{suffix}")
        return SymbolResolution(market="cn", yahoo_symbol=f"{raw}{suffix}")

    if ex == "USX" or ex == "NASDAQ" or ex == "NYSE" or ex == "ARCA":
        # META split: prefer the modern ticker (META over FB), keep the raw as-is
        return SymbolResolution(market="us", yahoo_symbol=raw)

    # Unknown exchange — best effort: if 4-5 digit, treat as HK; 6 digit as CN
    if _is_4digit_hk(raw):
        digits = raw.zfill(4)
        return SymbolResolution(market="hk", yahoo_symbol=f"{digits}.HK")
    if _is_6digit_cn(raw):
        # Default A-share rule (matches Vibe-Trading): 6xxx → SH, 0/3xxx → SZ
        prefix = raw[0]
        suffix = ".SH" if prefix == "6" else ".SZ"
        return SymbolResolution(market="cn", yahoo_symbol=f"{raw}{suffix}")

    return SymbolResolution(market="us", yahoo_symbol=raw)


# ----------------------------- CSV parsing -----------------------------------

@dataclass
class RawTransaction:
    date: date
    side: str              # "buy" or "sell"
    symbol: str
    exchange: str
    quantity: float
    price: float
    gross_amount: float
    net_amount: float
    fees: float
    currency: str
    label: str = ""
    note: str = ""
    id: int | None = None  # SQLite row id (set when loaded from DB, None for CSV)
    name: str = ""        # Cached company name

    def resolution(self) -> SymbolResolution:
        return resolve_symbol(self.symbol, self.exchange)


# Header normalization: maps known headers (case-insensitive, stripped) → canonical
_HEADER_ALIASES = {
    "side": {"side", "buy/sell", "buy_sell", "transaction type", "type",
             "sell (-1) buy (1) fees (0)"},
    "exchange": {"exchange", "market", "venue", "broker exchange"},
    "symbol": {"symbol", "ticker", "code", "stock code", "security code"},
    "quantity": {"quantity", "qty", "units", "units purchased or sold", "shares", "units_purchased_or_sold"},
    "price": {"price", "unit price", "execution price", "price paid or received"},
    "date": {"date", "trade date", "transaction date", "date of transaction",
             "date of transaction (yyyy-mm-dd)"},
    "currency": {"currency", "ccy"},
    "gross": {"gross", "gross amount", "total", "total before fees", "value", "amount"},
    "net": {"net", "net amount", "total after fees"},
    "fees": {"fees", "fee", "commission", "total fees"},
    "label": {"label", "label name", "category", "portfolio"},
    "note": {"note", "notes", "transaction details", "transaction details (optional)", "details"},
}


def _normalize_header(h: str) -> str:
    return (h or "").strip().lower()


def _detect_columns(headers: List[str]) -> dict[str, int]:
    """Map canonical field name -> column index."""
    norm = [_normalize_header(h) for h in headers]
    out: dict[str, int] = {}
    for canon, aliases in _HEADER_ALIASES.items():
        for i, h in enumerate(norm):
            if h in aliases and canon not in out:
                out[canon] = i
                break
    return out


def _to_float(x: str) -> float:
    if x is None:
        return 0.0
    s = str(x).strip().replace(",", "").replace('"', "")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _to_date(x: str) -> Optional[date]:
    s = (x or "").strip().strip('"')
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y",
                "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    # Try ISO
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def _infer_side(side_str: str, qty: float) -> str:
    """Buy (1) or sell (-1) — derive from sign of quantity too."""
    s = (side_str or "").strip().lower()
    if s in {"buy", "b", "1", "+1", "purchase", "long"}:
        return "buy"
    if s in {"sell", "s", "-1", "sale", "short"}:
        return "sell"
    if qty > 0:
        return "buy"
    if qty < 0:
        return "sell"
    return "buy"


def parse_csv_text(text: str) -> Tuple[List[RawTransaction], List[str]]:
    """Parse the CSV text and return (transactions, errors).

    Tries utf-8-sig → utf-8 → gbk → gb2312.
    """
    errors: List[str] = []
    rows: List[RawTransaction] = []
    reader = csv.reader(io.StringIO(text))
    headers: List[str] = []
    column_map: dict[str, int] = {}
    for i, row in enumerate(reader):
        if not row or all(not c.strip() for c in row):
            continue
        if not headers:
            headers = row
            column_map = _detect_columns(headers)
            missing = {"date", "quantity", "price"} - set(column_map.keys())
            if missing:
                errors.append(f"Required columns missing: {', '.join(sorted(missing))}")
                return [], errors
            continue
        try:
            raw_date = row[column_map["date"]]
            parsed_date = _to_date(raw_date)
            if not parsed_date:
                errors.append(f"Row {i + 1}: unparseable date {raw_date!r}")
                continue
            qty = _to_float(row[column_map["quantity"]])
            price = _to_float(row[column_map["price"]])
            side_str = row[column_map["side"]] if "side" in column_map else ""
            side = _infer_side(side_str, qty)
            # The user's CSV uses a signed quantity where the sign encodes side.
            # Strip the sign so internal quantity is always positive.
            abs_qty = abs(qty) if qty else _to_float(row[column_map["quantity"]])
            symbol = row[column_map["symbol"]].strip().strip('"')
            exchange = row[column_map["exchange"]].strip() if "exchange" in column_map else ""
            currency = row[column_map["currency"]].strip() if "currency" in column_map else "USD"
            gross = _to_float(row[column_map["gross"]]) if "gross" in column_map else (abs_qty * price)
            net = _to_float(row[column_map["net"]]) if "net" in column_map else gross
            fees = _to_float(row[column_map["fees"]]) if "fees" in column_map else 0.0
            label = row[column_map["label"]].strip() if "label" in column_map else ""
            note = row[column_map["note"]].strip() if "note" in column_map else ""
            rows.append(RawTransaction(
                date=parsed_date,
                side=side,
                symbol=symbol,
                exchange=exchange,
                quantity=abs_qty,
                price=price,
                gross_amount=gross,
                net_amount=net,
                fees=fees,
                currency=currency,
                label=label,
                note=note,
            ))
        except (IndexError, KeyError) as e:
            errors.append(f"Row {i + 1}: {e}")
            continue
    return rows, errors


def load_csv(path: str | Path) -> Tuple[List[RawTransaction], List[str]]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"CSV not found: {p}")
    raw = p.read_bytes()
    text: Optional[str] = None
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb2312"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError(f"Could not decode {p}")
    return parse_csv_text(text)
