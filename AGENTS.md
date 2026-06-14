## Goal
Personal portfolio tracker with FIFO cost basis, multi-currency (USD/HKD/SGD), live prices via yfinance, SQLite persistence, and financial advice.

## Constraints & Preferences
- Parse broker CSV with schema: `Sell (-1) Buy (1)` side column, exchanges USX/HKEX/LSE/SGX/SSB, multi-currency
- Each currency row shows native currency values; totals row in SGD base
- **P&L = unrealized + realized (closed positions baked in) + dividends** — summed in P&L % + divs column
- **avg_cost = cost_basis / qty of REMAINING open lots** (standard FIFO). Closed positions' P&L is reflected in the realized P&L component, NOT in avg_cost
- Historical FX rates fetched per lot acquisition date from yfinance, persisted to SQLite
- Savings bonds at face value (no live price needed)
- LLM advice optional (falls back to rule-based engine)

## Progress
### Done
- SQLite persistence layer (`backend/app/db.py`): 5 tables — transactions, open_lots, roundtrips, dividend_events, fx_rates
- FX historical rates: `FxService.get_historical_rate(from, to, date)` with SQLite cache (survives restarts)
- Capital now uses historical FX rates per lot acquisition date (not today's rates)
- XIRR uses historical FX rates per transaction date
- Holdings table: Symbol, Name, Market, Qty, **Avg cost** (open lots only), Price, Mkt Cost, Mkt val, **P&L** (unrealized + realized combined), P&L % + divs; subtotals per currency group
- Transactions page: full-height table, proper currency symbols ($, S$, HK$, £, ¥), checkbox multi-select, delete by symbol
- Add Transaction page at `/transactions/add`: POST `/api/portfolio/transactions`, auto-rebuilds roundtrips/open_lots/dividends
- Delete transaction endpoint: `DELETE /api/portfolio/transactions/{symbol}`
- Roundtrips page at `/roundtrips`: both BUY and SELL legs displayed, sortable columns, filter by symbol/type, stats bar
- CurrencyPnL component redesigned: 2×2 header grid (TWR/XIRR/Capital/Net Worth with S$ symbols), 8-column table with group borders
- GOOGL and EH transactions removed from CSV (5 rows deleted, holdings 17→15)
- Name column added to Holdings, Transactions, and Dividends tables
- Holdings grouped by currency dynamically
- Cross-verified avg_cost math: all-time weighted avg was WRONG (caused avg_cost × qty ≠ cost_basis). Reverted to cost_basis / qty of remaining open lots. P&L column SUMS unrealized + realized + dividends; avg_cost is just the FIFO cost of remaining shares
- **Fixed double-withholding bug**: `dividend_events` table now has `withholding_rate` column (idempotent migration). `_load_from_db` no longer re-applies withholding on each load (was causing compound decay: stored value × 0.7 per restart). `_needs_dividend_backfill()` + `_backfill_dividends_async()` detect and re-fetch legacy data automatically
- **Dividend auto-refresh + unified refresh endpoint**: daily 8am scheduler calls `rebuild_dashboard_cache()` (which does prices + dividends + cache). Single `POST /api/portfolio/cache/refresh` endpoint used by the sidebar "Refresh" button and the Dividends page UI. The old `prices/refresh` and `dividends/refresh` endpoints are removed
- **No-dividend negative cache**: `dividend_no_div_cache` table + 1-day in-memory TTL cache in `MarketDataService.get_dividends` skip delisted SPACs and non-dividend tickers. `has_dividend_history()` is the only signal that marks symbols as "no dividends" — never the empty result of `estimate_received_dividends` (which can also be empty when the user simply didn't hold at an ex-date)
- **Persistent sessions + host consistency**: `dev.sh` reads the host from `OAUTH_REDIRECT_URI` in `.env` so the OAuth callback, backend, and frontend all run on the same hostname. A mismatch causes the browser to refuse the session cookie (cookies are scoped to one origin), forcing a re-login on every page refresh. `_warn_host_mismatch()` in `main.py` logs a warning at startup if the hosts disagree

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- **P&L = unrealized + realized + dividends combined**: P&L column shows the sum, P&L % + divs shows the percentage. The "closed positions baked in" means closed P&L is ADDED to the column, not mixed into avg_cost
- **avg_cost = open lots FIFO**: avg_cost × qty MUST equal cost_basis (the Mkt Cost column). Mixing sold shares into avg_cost creates internal inconsistency
- **Historical FX for capital**: each lot's cost_basis converted at rate on its acquisition date
- **SQLite on startup**: if DB exists with transactions, load from SQLite (skip FIFO rebuild + dividend yfinance fetch)
- **FX rates persistent**: fetched on-demand per lot date, cached in SQLite
- **Add/delete rebuild strategy**: every add/delete wipes all 5 SQLite tables and repersists
- **Dividend withholding stored on write**: `dividend_events.withholding_rate` is persisted so the load is idempotent. The stored `total_received` is the NET (after withholding) amount. On load, we only re-apply withholding if the rate has changed (gross up using stored rate, re-apply new rate)
- **Backfill runs async on first load**: if `_needs_dividend_backfill()` detects legacy data, a background thread wipes and re-fetches from yfinance. The user's first request after the fix may return stale data for a few seconds; subsequent requests show correct values

## Next Steps
- (none)

## Critical Context
- **Python 3.14.4**; scipy for XIRR; npm v24/v11 for frontend
- DB location: `backend/data/transactions.db` (auto-created next to CSV)
- Current portfolio: 15 open holdings, 307 roundtrips, 468 transactions
- TWR −24.80%, XIRR −5.96%, Capital SGD 194,294, Net Worth ~SGD 145,884

## Relevant Files
- `backend/app/db.py`: SQLite persistence
- `backend/app/store.py`: SQLite-backed store with `_load_from_db()` and `_rebuild_from_transactions()`
- `backend/app/services/portfolio.py`: `summarize_holdings()` computes avg_cost = cost_basis/qty of open lots
- `backend/app/services/fx.py`: `FxService.get_historical_rate()` with SQLite cache
- `frontend/src/pages/Holdings.tsx`: combined P&L (unrealized + realized + divs)
- `frontend/src/pages/Transactions.tsx`: checkbox multi-select delete
- `frontend/src/pages/Roundtrips.tsx`: BUY+SELL legs side-by-side
- `frontend/src/components/CurrencyPnL.tsx`: 2×2 metric grid
- `backend/data/transactions.csv`: GOOGL/EH removed
