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

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Google OAuth credentials (for login)

### 1. Install dependencies

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

Create `backend/data/.env` with:

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OAUTH_REDIRECT_URI=http://localhost:8765/api/auth/google/callback
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SESSION_SECRET=any-random-string-here
DEFAULT_USER_EMAIL=your-email@gmail.com
ADMIN_EMAILS=your-email@gmail.com
```

### 3. Import transactions (optional)

Place your broker CSV at `backend/data/transactions.csv`. On first startup, transactions auto-import for the `DEFAULT_USER_EMAIL` user.

### 4. Start the app

```bash
# Windows
.\dev.ps1

# macOS/Linux
./dev.sh
```

The database (`backend/data/portfolio.db`) auto-creates on first run.

### 5. Login

Open `http://localhost:5173` and sign in with Google.

## Architecture

```
equity-ark/
├── backend/                # FastAPI
│   ├── app/
│   │   ├── main.py         # FastAPI app + routes
│   │   ├── store.py        # SQLite-backed portfolio store
│   │   ├── db.py           # SQLite persistence layer
│   │   ├── schemas.py      # Pydantic models
│   │   └── services/
│   │       ├── csv_parser.py       # CSV → RawTransaction
│   │       ├── portfolio.py        # FIFO lots, holdings, roundtrips, profile
│   │       ├── market_data.py      # yfinance wrapper (with TTL cache)
│   │       ├── dividends.py        # Dividend history → received income
│   │       ├── fx.py               # Historical FX rates with SQLite cache
│   │       └── advice.py           # Rule-based + LLM advice engine
│   ├── data/
│   │   ├── transactions.csv  # Your transactions (loaded on startup)
│   │   └── portfolio.db      # Auto-created SQLite database
│   └── requirements.txt
└── frontend/               # React 19 + Vite + Tailwind + Zustand
    └── src/
        ├── App.tsx
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Holdings.tsx
        │   ├── Transactions.tsx
        │   ├── Roundtrips.tsx
        │   ├── Dividends.tsx
        │   └── Advice.tsx
        ├── components/
        │   ├── CurrencyPnL.tsx
        │   └── MobileTable.tsx
        └── hooks/
            └── usePortfolio.ts
```

## CSV Format

The parser is header-aliased — column names are matched case-insensitively with common variants.

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

## Symbol Resolution

| Exchange | CSV symbol | yfinance symbol |
|---|---|---|
| USX / NASDAQ / NYSE | `BABA` | `BABA` |
| HKEX | `9866` | `0986.HK` |
| LSE | `IWDA` | `IWDA.L` |
| SGX | `D05` | `D05.SI` |
| SSB | `GX22090Z` | (no market data — Singapore Savings Bonds) |

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness + counts |
| `GET /api/portfolio/summary?base_currency=SGD` | Aggregate P&L by market & currency |
| `GET /api/portfolio/holdings?refresh=false` | Open positions + live prices |
| `GET /api/portfolio/transactions?symbol=&market=` | Full transaction log |
| `GET /api/portfolio/roundtrips` | Closed trades + profile metrics |
| `GET /api/portfolio/dividends` | Dividend events + summary |
| `GET /api/portfolio/profile` | Trading profile (win rate, P/L ratio, …) |
| `POST /api/portfolio/reload` | Re-parse the CSV from disk |
| `POST /api/portfolio/upload` | Multipart CSV upload → rebuild |
| `POST /api/portfolio/cache/refresh` | Re-fetch prices + dividends from yfinance |
| `POST /api/portfolio/advice` | Generate advice report |

Open `http://localhost:8765/docs` for the interactive Swagger UI.

## Reused from Vibe-Trading

- `yfinance` symbol resolution
- FIFO lot matching algorithm
- Dividend-analysis methodology (yield, payout coverage, balance-sheet health, growth quality)
- React 19 + Vite + Tailwind + Zustand frontend stack
- Trade-journal behaviour diagnostics (win rate, P/L ratio, fee drag, overtrading)

## Disclaimer

This is a personal-use portfolio tracker. The "AI advisor" output is **educational analysis, not personalised financial advice**. Past performance does not guarantee future results. Verify any tax, currency, or cost-basis figures against your broker's official statement before making decisions.
