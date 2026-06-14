# equity.ark

A personal portfolio tracker with live prices, FIFO cost basis, dividend tracking, and AI-powered financial advice.

Built on the same data layer and dividend-analysis methodology as the upstream **Vibe-Trading** project (loader registry, yfinance symbol resolution, FIFO lot matching, dividend skill).

## Features

- **Track all your past transactions** — parses your broker CSV (Futu / Tiger / Trading 212 / generic) with columns for `Sell (-1) Buy (1)`, exchange (`USX`/`HKEX`/`LSE`/`SGX`/`SSB`), currency, fees, and notes.
- **Current portfolio table** — per-symbol holdings with quantity, average cost, current price, market value, unrealized P&L.
- **Performance analytics** — realized P&L from closed roundtrips, win rate, profit/loss ratio, largest winner/loser, best/worst trade, dividend CAGR.
- **Dividend tracking** — for every open holding, fetches yfinance dividend history and estimates the income you would have received, sliced by symbol and year. Single-name payout concentration is flagged.
- **Market diversification** — exposure broken down by market (US / HK / UK / SG / CN / SG savings bonds) and currency.
- **AI financial advice** — a rule-based engine produces concentration, behaviour, drawdown, and dividend findings. Add `OPENAI_API_KEY` to upgrade to an LLM-powered narrative that cites your numbers.
- **Upload new CSVs** via the UI or POST `/api/portfolio/upload` — the engine rebuilds holdings, roundtrips, and dividends in memory.

## Architecture

```
equity-ark/
├── backend/                # FastAPI
│   ├── app/
│   │   ├── main.py         # FastAPI app + routes
│   │   ├── store.py        # In-memory portfolio store
│   │   ├── schemas.py      # Pydantic models
│   │   └── services/
│   │       ├── csv_parser.py       # CSV → RawTransaction
│   │       ├── portfolio.py        # FIFO lots, holdings, roundtrips, profile
│   │       ├── market_data.py      # yfinance wrapper (with TTL cache)
│   │       ├── dividends.py        # Dividend history → received income
│   │       └── advice.py           # Rule-based + LLM advice engine
│   ├── data/transactions.csv       # Your transactions (loaded on startup)
│   └── requirements.txt
└── frontend/               # React 19 + Vite + Tailwind + Zustand
    └── src/
        ├── App.tsx
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Holdings.tsx
        │   ├── Transactions.tsx
        │   ├── Dividends.tsx
        │   └── Advice.tsx
        ├── lib/api.ts
        └── stores/useStore.ts
```

## Quick start

### 1. Install dependencies

```bash
# Backend
cd backend
python3 -m pip install --user -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. (Optional) enable LLM-powered advice

```bash
cd backend
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

### 3. Run both servers

```bash
./dev.sh
```

This starts:
- Backend at <http://127.0.0.1:8765>  (interactive API docs at `/docs`)
- Frontend at <http://127.0.0.1:5173>

Open <http://127.0.0.1:5173> in your browser.

### 4. Or run them separately

```bash
# Terminal 1
cd backend
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

# Terminal 2
cd frontend
npx vite --host 127.0.0.1 --port 5173
```

## CSV format

The default dataset ships with the broker export in `backend/data/transactions.csv`. It uses these columns:

| Column | Required | Notes |
|---|---|---|
| `Sell (-1) Buy (1) Fees (0)` | yes | `1` = buy, `-1` = sell |
| `Exchange` | yes | `USX` / `HKEX` / `LSE` / `SGX` / `SSB` / `SH` / `SZ` |
| `Symbol` | yes | Ticker code, e.g. `BABA`, `9866`, `IWDA`, `GX22090Z` |
| `Units Purchased or Sold` | yes | Quantity (sign is ignored — side column wins) |
| `Price Paid or Received` | yes | Per-unit price |
| `Date of transaction (YYYY-MM-DD)` | yes | |
| `Currency` | yes | USD / HKD / SGD / … |
| `Total before fees` | no | Defaults to qty × price |
| `Total after fees` | no | Defaults to before-fees |
| `Fees` | no | Defaults to 0 |
| `Label Name` | no | Free-form category |
| `Transaction Details (Optional)` | no | Free-form note |

The parser is header-aliased — column names are matched case-insensitively with common variants (`Symbol`/`Ticker`/`Code`, `Date`/`Trade Date`/`Date of transaction`, etc.).

## Symbol resolution

The CSV `Symbol` column is bare. The engine adds an exchange suffix automatically when calling yfinance:

| Exchange | CSV symbol | yfinance symbol |
|---|---|---|
| USX / NASDAQ / NYSE | `BABA` | `BABA` |
| HKEX | `9866` | `0986.HK` |
| LSE | `IWDA` | `IWDA.L` |
| SGX | `D05` | `D05.SI` |
| SSB | `GX22090Z` | (no market data — Singapore Savings Bonds) |

For SG savings bonds (`SSB` exchange or `GX*` / `IN*` tickers), the engine reports cost basis but no live price — they pay fixed coupons and aren't tradable.

## API reference

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness + counts |
| `GET /api/portfolio/summary?base_currency=USD` | Aggregate P&L by market & currency |
| `GET /api/portfolio/holdings?refresh=false` | Open positions + live prices |
| `GET /api/portfolio/transactions?symbol=&market=` | Full transaction log |
| `GET /api/portfolio/roundtrips` | Closed trades + profile metrics |
| `GET /api/portfolio/dividends` | Dividend events + summary |
| `GET /api/portfolio/profile` | Trading profile (win rate, P/L ratio, …) |
| `POST /api/portfolio/reload` | Re-parse the CSV from disk |
| `POST /api/portfolio/upload` | Multipart CSV upload → rebuild |
| `POST /api/portfolio/cache/refresh` | Re-fetch prices + dividends from yfinance, rebuild dashboard cache |
| `POST /api/portfolio/advice` | Generate advice report (`focus` + `custom_question`) |

Open <http://127.0.0.1:8765/docs> for the interactive Swagger UI.

## Reused from Vibe-Trading

- `yfinance` symbol resolution (`AAPL.US` → `AAPL`, `0700.HK` → `0700.HK`, etc.)
- FIFO lot matching algorithm from `agent/src/tools/trade_journal_tool.py:33`
- Dividend-analysis methodology from `agent/src/skills/dividend-analysis/SKILL.md` (yield, payout coverage, balance-sheet health, growth quality, 3-scenario view)
- React 19 + Vite + Tailwind + Zustand frontend stack
- Trade-journal behaviour diagnostics (win rate, P/L ratio, fee drag, overtrading)

## Disclaimer

This is a personal-use portfolio tracker. The "AI advisor" output is **educational analysis, not personalised financial advice**. Past performance does not guarantee future results. Verify any tax, currency, or cost-basis figures against your broker's official statement before making decisions.
