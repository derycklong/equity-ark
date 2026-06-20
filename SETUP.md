# First-Time Setup

## Prerequisites
- Python 3.11+
- Node.js 18+
- Google OAuth credentials (for login)

## 1. Install dependencies

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

## 2. Configure environment

Copy and edit the backend env file:

```bash
cd backend
cp data/.env.example data/.env   # if available, or create manually
```

Required variables in `backend/data/.env`:
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

## 3. Import transactions (optional)

Place your broker CSV at `backend/data/transactions.csv`. On first startup, transactions auto-import for the `DEFAULT_USER_EMAIL` user.

CSV schema:
```
Date,Side,Symbol,Exchange,Quantity,Price,Gross Amount,Net Amount,Fees,Currency,Label,Note,Name
```

## 4. Start the app

```bash
# Windows
.\dev.ps1

# macOS/Linux
./dev.sh
```

The database (`backend/data/portfolio.db`) auto-creates on first run.

## 5. Login

Open `http://localhost:5173` and sign in with Google.
