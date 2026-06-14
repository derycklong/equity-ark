"""Pydantic schemas for the API."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class Transaction(BaseModel):
    id: str = Field(..., description="Stable id derived from row index")
    date: date
    side: str = Field(..., description="'buy' or 'sell'")
    symbol: str = Field(..., description="Raw symbol as it appears in the CSV (e.g. BABA, 9866, IWDA)")
    exchange: str = Field(..., description="Exchange code from the CSV: USX/HKEX/LSE/SGX/SSB")
    market: str = Field(..., description="Resolved market: us/hk/uk/sg/fund/cash/other")
    quantity: float
    price: float
    currency: str
    gross_amount: float
    net_amount: float
    fees: float
    label: str = ""
    note: str = ""
    yahoo_symbol: str = Field("", description="Symbol resolved for yfinance (e.g. BABA, 0986.HK, IWDA.L)")


class TransactionInput(BaseModel):
    """Input schema for creating a new transaction."""
    date: date
    side: str = Field(..., pattern="^(buy|sell)$")
    symbol: str = Field(..., min_length=1, max_length=20)
    exchange: str = Field(default="USX", max_length=10)
    quantity: float = Field(..., gt=0)
    price: float = Field(..., ge=0)
    currency: str = Field(default="USD", max_length=8)
    fees: float = Field(default=0.0, ge=0)
    label: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)


class HoldingLot(BaseModel):
    """One open FIFO lot within a holding."""
    symbol: str
    market: str
    currency: str
    yahoo_symbol: str
    exchange: str
    quantity: float
    cost_basis: float
    avg_cost: float
    acquired: date
    label: str = ""


class Holding(BaseModel):
    symbol: str
    market: str
    currency: str
    yahoo_symbol: str
    exchange: str
    quantity: float
    cost_basis: float
    avg_cost: float
    current_price: Optional[float] = None
    market_value: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    unrealized_pnl_pct: Optional[float] = None
    day_change_pct: Optional[float] = None
    realized_pnl: float = 0.0
    label: str = ""
    first_acquired: Optional[date] = None
    dividends_received: float = 0.0
    lots: List[HoldingLot] = Field(default_factory=list)


class PortfolioSummary(BaseModel):
    total_cost_basis: float
    total_market_value: float
    total_unrealized_pnl: float
    total_unrealized_pnl_pct: float
    total_realized_pnl: float
    total_dividends: float
    day_change: float
    day_change_pct: float
    holdings_count: int
    positions_count: int
    by_market: dict[str, dict[str, float]] = Field(default_factory=dict)
    by_currency: dict[str, dict[str, float]] = Field(default_factory=dict)


class Roundtrip(BaseModel):
    symbol: str
    market: str
    currency: str
    yahoo_symbol: str
    buy_date: date
    sell_date: date
    quantity: float
    buy_price: float
    sell_price: float
    cost: float
    proceeds: float
    pnl: float
    pnl_pct: float
    hold_days: float
    fees: float = 0.0


class ProfileMetrics(BaseModel):
    total_transactions: int
    total_roundtrips: int
    open_positions: int
    win_rate: float
    avg_winner: float
    avg_loser: float
    profit_loss_ratio: float
    avg_holding_days: float
    total_realized_pnl: float
    total_fees: float
    total_dividends: float
    largest_winner: float
    largest_loser: float
    span_days: int
    start_date: Optional[date]
    end_date: Optional[date]
    top_symbols: List[dict] = Field(default_factory=list)
    market_distribution: dict[str, int] = Field(default_factory=dict)
    best_roundtrip: Optional[dict] = None
    worst_roundtrip: Optional[dict] = None


class PriceQuote(BaseModel):
    symbol: str
    yahoo_symbol: str
    market: str
    currency: str
    price: Optional[float] = None
    previous_close: Optional[float] = None
    change_pct: Optional[float] = None
    as_of: Optional[datetime] = None
    name: Optional[str] = None
    error: Optional[str] = None


class DividendEvent(BaseModel):
    symbol: str
    yahoo_symbol: str
    ex_date: date
    pay_date: Optional[date] = None
    amount_per_share: float
    currency: str
    shares_at_ex: Optional[float] = None
    total_received: Optional[float] = None
    note: str = ""


class DividendSummary(BaseModel):
    total_received: float
    events_count: int
    by_symbol: List[dict]
    by_year: dict[str, float] = Field(default_factory=dict)
    forward_yield_pct: float = 0.0
    trailing_12m: float = 0.0
    upcoming: List[dict] = Field(default_factory=list)


class AdviceRequest(BaseModel):
    focus: str = Field("full", description="full | risk | dividends | tax | rebalance")
    custom_question: Optional[str] = Field(default=None, max_length=1000)
    refresh: bool = Field(default=False, description="Bypass cache and regenerate the LLM report")


class AdviceReport(BaseModel):
    generated_at: datetime
    summary: str
    sections: List[dict] = Field(default_factory=list)
    risk_flags: List[str] = Field(default_factory=list)
    opportunities: List[str] = Field(default_factory=list)
    raw_markdown: str = ""
    source: str = "rule-based"


class UploadResult(BaseModel):
    imported: int
    skipped: int
    errors: List[str] = Field(default_factory=list)
