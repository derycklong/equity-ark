"""FastAPI application for Vibe-Portfolio (multi-user with Google OAuth)."""
from __future__ import annotations

import logging
import os
import secrets
import threading
import time as _time
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeSerializer
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from .schemas import AdviceRequest, AdviceReport, TransactionInput, UploadResult
from .services.advice import generate_advice, compute_findings
from .services.csv_parser import resolve_symbol
from .store import PortfolioStore
from .store_manager import StoreManager
from .env_config import get_admin_emails

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("vibe-portfolio")

# ----- host consistency check (cookie origin matters) -----
# The OAuth callback sets the session cookie on whatever host the callback
# lands on. If the frontend then serves on a different host, the browser
# treats them as separate origins and the cookie is not sent — the user has
# to re-login on every page refresh. Warn loudly if OAUTH_REDIRECT_URI,
# FRONTEND_URL, and CORS_ORIGINS disagree on the host.
def _warn_host_mismatch() -> None:
    from urllib.parse import urlparse
    oauth_host = urlparse(os.environ.get("OAUTH_REDIRECT_URI", "")).hostname
    fe_host = urlparse(os.environ.get("FRONTEND_URL", "")).hostname
    cors = os.environ.get("CORS_ORIGINS", "")
    cors_hosts = {urlparse(o.strip()).hostname for o in cors.split(",") if o.strip()}
    if not oauth_host:
        return
    if fe_host and fe_host != oauth_host:
        logger.warning(
            "Host mismatch: OAUTH_REDIRECT_URI=%s but FRONTEND_URL=%s. "
            "The session cookie will be set on '%s' but the user accesses "
            "the app via '%s' — browsers treat them as different origins and "
            "won't send the cookie, causing a re-login on every refresh. "
            "Fix: make both URLs use the same host.",
            oauth_host, fe_host, oauth_host, fe_host,
        )
    if cors_hosts and oauth_host not in cors_hosts:
        logger.warning(
            "OAUTH_REDIRECT_URI host '%s' is not in CORS_ORIGINS=%s",
            oauth_host, cors,
        )

_warn_host_mismatch()

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ----------------------------- lifespan -------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    store_manager = StoreManager(
        db_path=DATA_DIR / "portfolio.db",
        data_dir=DATA_DIR,
        max_cached_users=int(os.environ.get("MAX_CACHED_USERS", "50")),
    )
    app.state.store_manager = store_manager
    # Cleanup expired sessions on startup
    store_manager.db.cleanup_expired_sessions()

    # Auto-migrate: if per-user DBs exist under data/users/, import them into shared DB
    migrated = store_manager.db.migrate_per_user_dbs(DATA_DIR)
    if migrated:
        logger.info("Migrated %d transactions from per-user DBs to shared DB", migrated)
        # Also import legacy DB
        legacy_db = DATA_DIR / "transactions.db"
        if legacy_db.exists():
            default_email = os.environ.get("DEFAULT_USER_EMAIL", "").strip().lower()
            if default_email:
                user = store_manager.db.get_user_by_email(default_email)
                if user is None:
                    user = store_manager.db.upsert_user(default_email, default_email.split("@")[0].title(), "")
                # Check if user already has data
                existing = store_manager.db.load_transactions(user["id"])
                if not existing:
                    try:
                        import sqlite3
                        tmp = sqlite3.connect(f"file:{legacy_db}?mode=ro", uri=True)
                        rows = tmp.execute("SELECT * FROM transactions").fetchall()
                        for r in rows:
                            store_manager.db._conn().execute(
                                """INSERT OR IGNORE INTO transactions
                                   (user_id, date, side, symbol, exchange, quantity, price,
                                    gross_amount, net_amount, fees, currency, label, note, name)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                                (user["id"], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13])
                            )
                        # Migrate lots
                        try:
                            lots = tmp.execute("SELECT * FROM open_lots").fetchall()
                            for r in lots:
                                store_manager.db._conn().execute(
                                    "INSERT OR IGNORE INTO open_lots (user_id, symbol, acquired, quantity, price, cost_basis, fees) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                    (user["id"], r[1], r[2], r[3], r[4], r[5], r[6])
                                )
                        except Exception:
                            pass
                        # Migrate roundtrips
                        try:
                            rts = tmp.execute("SELECT * FROM roundtrips").fetchall()
                            for r in rts:
                                store_manager.db._conn().execute(
                                    """INSERT OR IGNORE INTO roundtrips
                                       (user_id, symbol, market, currency, exchange, yahoo_symbol,
                                        buy_date, sell_date, quantity, buy_price, sell_price,
                                        cost, proceeds, fees, pnl, pnl_pct, hold_days)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                                    (user["id"], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16])
                                )
                        except Exception:
                            pass
                        # Migrate dividend events
                        try:
                            divs = tmp.execute("SELECT * FROM dividend_events").fetchall()
                            for r in divs:
                                store_manager.db._conn().execute(
                                    """INSERT OR IGNORE INTO dividend_events
                                       (user_id, symbol, yahoo_symbol, ex_date, currency,
                                        amount_per_share, shares_at_ex, total_received)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                                    (user["id"], r[1], r[2], r[3], r[4], r[5], r[6], r[7])
                                )
                        except Exception:
                            pass
                        # Migrate fund aliases
                        try:
                            fas = tmp.execute("SELECT * FROM fund_aliases").fetchall()
                            for r in fas:
                                store_manager.db._conn().execute(
                                    "INSERT OR IGNORE INTO fund_aliases (user_id, alias, isin, fund_name, created_at) VALUES (?, ?, ?, ?, ?)",
                                    (user["id"], r[0], r[1], r[2], r[3])
                                )
                        except Exception:
                            pass
                        # Merge fx_rates
                        try:
                            fx = tmp.execute("SELECT * FROM fx_rates").fetchall()
                            for r in fx:
                                store_manager.db._conn().execute(
                                    "INSERT OR IGNORE INTO fx_rates (from_ccy, to_ccy, date_str, rate, fetched_at) VALUES (?, ?, ?, ?, ?)",
                                    r[1:]
                                )
                        except Exception:
                            pass
                        tmp.close()
                        store_manager.db._conn().commit()
                        logger.info("Migrated legacy DB to user %s: %d txs", user["email"], len(rows))
                    except Exception as e:
                        logger.error("Legacy migration failed: %s", e)

    # Start daily scheduler thread
    scheduler = threading.Thread(target=_daily_scheduler, daemon=True)
    scheduler.start()

    logger.info("Vibe-Portfolio ready (data dir: %s)", DATA_DIR)
    yield


app = FastAPI(title="Vibe-Portfolio", version="0.1.0", lifespan=lifespan)

# ----------------------------- exception handlers ----------------------------
# Log full traceback server-side, return generic message to avoid leaking internals.

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ----------------------------- security middleware ---------------------------

# Item 5: CSRF protection via Origin/Referer check on state-changing requests.
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _get_cors_origins() -> list:
    origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip() for o in origins.split(",") if o.strip()]


@app.middleware("http")
async def csrf_protect(request: Request, call_next):
    if request.method not in _SAFE_METHODS:
        allowed = _get_cors_origins()
        origin = request.headers.get("origin") or ""
        if not origin:
            referer = request.headers.get("referer", "")
            # Use scheme+netloc from referer as origin
            from urllib.parse import urlparse
            parsed = urlparse(referer)
            origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
        if allowed and origin not in allowed:
            logger.warning(
                "Blocked cross-origin %s %s (origin=%r, allowed=%s)",
                request.method, request.url.path, origin, allowed,
            )
            return JSONResponse(status_code=403, content={"detail": "Forbidden: cross-origin request blocked"})
    return await call_next(request)


# Item 6: Lightweight in-memory rate limiter.
from collections import defaultdict as _defaultdict
import time as _time

_RATE_LIMITS: dict = {
    "/api/auth/google/login": (20, 60.0),
    "/api/auth/google/callback": (20, 60.0),
    "/api/auth/logout": (30, 60.0),
    "/api/portfolio/upload": (5, 60.0),
    "/api/portfolio/symbols/validate": (30, 60.0),
    "/api/portfolio/cache/refresh": (5, 60.0),
    "/api/portfolio/transactions": (60, 60.0),
    "/api/portfolio/advice": (10, 60.0),
    "_default": (120, 60.0),
}
_rate_buckets: dict = _defaultdict(lambda: [0, 0.0])


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    ip = request.client.host if request.client else "unknown"
    path = request.url.path
    prefix = next((p for p in _RATE_LIMITS if p != "_default" and path.startswith(p)), "_default")
    max_req, window = _RATE_LIMITS[prefix]
    key = (ip, prefix)
    bucket = _rate_buckets[key]
    now = _time.time()
    if now > bucket[1]:
        bucket[0] = 0
        bucket[1] = now + window
    if bucket[0] >= max_req:
        logger.warning("Rate limit hit: %s on %s", ip, path)
        return JSONResponse(status_code=429, content={"detail": "Too many requests"})
    bucket[0] += 1
    return await call_next(request)


# ----------------------------- auth setup ------------------------------------
# Force-load .env directly into os.environ so it works regardless of uvicorn's
# subprocess architecture. The python-dotenv library can fail silently when
# called from certain reload worker contexts.
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / "data" / ".env"
if _ENV_FILE.exists():
    import re as _re
    _text = _ENV_FILE.read_text(encoding="utf-8")
    for _line in _text.splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#"):
            continue
        _m = _re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", _line)
        if _m:
            _key, _val = _m.group(1), _m.group(2).strip("\"'").strip()
            if _key not in os.environ:
                os.environ[_key] = _val

# Log the admin config so it's obvious at startup whether admin is enabled.
_admin_emails = get_admin_emails()
if _admin_emails:
    logger.info(
        "Admin enabled for %d email(s) (set in data/.env as ADMIN_EMAILS)",
        len(_admin_emails),
    )
    if os.environ.get("ADMIN_EMAILS"):
        # Both could be set; if only the new name is used, no warning.
        pass
    elif os.environ.get("ADMIN_EMAIL"):
        logger.warning(
            "ADMIN_EMAIL is deprecated; rename to ADMIN_EMAILS in data/.env "
            "(supports multiple comma-separated admins).",
        )
else:
    logger.info(
        "Admin disabled — set ADMIN_EMAILS=you@example.com in data/.env and restart to enable /admin",
    )

SESSION_COOKIE_NAME = "vibe_session"
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)
if not os.environ.get("SESSION_SECRET"):
    logger.warning("SESSION_SECRET not set — generated a random one (sessions won't survive restarts)")

_serializer = URLSafeSerializer(SESSION_SECRET, salt="vibe-session")

# CORS — refuse wildcard when credentials are enabled, lock down methods/headers.
cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
if "*" in cors_origins:
    raise RuntimeError("CORS_ORIGINS cannot contain '*' when allow_credentials=True. Refusing to start.")
if not cors_origins and os.environ.get("ENV") == "prod":
    raise RuntimeError("CORS_ORIGINS must be set in production. Refusing to start with wildcard CORS.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
# SessionMiddleware required by Authlib for OAuth state storage
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=60 * 60 * 24 * 30)

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
OAUTH_REDIRECT_URI = os.environ.get("OAUTH_REDIRECT_URI", "http://127.0.0.1:8765/api/auth/google/callback")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://127.0.0.1:5173")

oauth = OAuth()
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

# ----------------------------- auth helpers ----------------------------------

def _make_session_cookie(token: str) -> str:
    """Sign the session token for the cookie value (defense in depth)."""
    return _serializer.dumps(token)

def _read_session_cookie(value: str) -> Optional[str]:
    """Verify and return the session token from a signed cookie value."""
    try:
        return _serializer.loads(value)
    except BadSignature:
        return None


def get_current_user(request: Request) -> dict:
    """FastAPI dependency: extract the current user from the session cookie."""
    raw = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = _read_session_cookie(raw)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid session")
    sess = request.app.state.store_manager.db.get_session(token)
    if not sess:
        raise HTTPException(status_code=401, detail="Session expired")
    user = request.app.state.store_manager.db.get_user(sess["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_user_store(request: Request, user: dict = Depends(get_current_user)) -> PortfolioStore:
    """FastAPI dependency: get the per-user PortfolioStore."""
    return request.app.state.store_manager.get_store(user["id"])


# ----------------------------- auth routes -----------------------------------

@app.get("/api/auth/me")
def auth_me(user: dict = Depends(get_current_user)) -> dict:
    admins = get_admin_emails()
    user_out = dict(user)
    user_out["is_admin"] = user.get("email", "").lower() in admins
    return {"user": user_out}


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: 403 unless the caller's email is in ADMIN_EMAILS."""
    admins = get_admin_emails()
    if user.get("email", "").lower() not in admins:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@app.get("/api/auth/google/login")
async def auth_google_login(request: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")
    # Authlib handles the redirect to Google's OAuth provider
    redirect_uri = OAUTH_REDIRECT_URI
    return await oauth.google.authorize_redirect(request, redirect_uri)


@app.get("/api/auth/google/callback")
async def auth_google_callback(request: Request, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as e:
        logger.error("OAuth callback failed: %s", e)
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=oauth_failed")
    userinfo = token.get("userinfo") or {}
    if not userinfo:
        # Fetch via userinfo endpoint if not included
        try:
            userinfo = await oauth.google.parse_id_token(request, token)
        except Exception:
            pass
    email = userinfo.get("email")
    if not email:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=no_email")
    if not userinfo.get("email_verified"):
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=email_not_verified")
    name = userinfo.get("name", "")
    picture = userinfo.get("picture", "")
    user = request.app.state.store_manager.db.upsert_user(email, name, picture)
    # Create session
    token_str = request.app.state.store_manager.db.create_session(user["id"])
    signed = _make_session_cookie(token_str)
    # Redirect to frontend with cookie set
    resp = RedirectResponse(url=f"{FRONTEND_URL}/")
    resp.set_cookie(
        SESSION_COOKIE_NAME,
        signed,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("ENV", "dev") == "prod",
        path="/",
    )
    return resp


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response, user: dict = Depends(get_current_user)):
    raw = request.cookies.get(SESSION_COOKIE_NAME)
    if raw:
        token = _read_session_cookie(raw)
        if token:
            request.app.state.store_manager.db.delete_session(token)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"status": "ok"}


# ----------------------------- admin ------------------------------------------

@app.get("/api/admin/users")
def admin_list_users(request: Request, admin: dict = Depends(require_admin)) -> dict:
    """Return every known user with last-login timestamp. Admin-only."""
    users = request.app.state.store_manager.db.list_all_users()
    return {"users": users, "admin_emails": get_admin_emails()}


# ----------------------------- helpers ---------------------------------------

def _llm_config() -> Optional[dict]:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    return {
        "api_key": api_key,
        "base_url": os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
    }


# ----------------------------- public routes --------------------------------

@app.get("/api/health")
def health() -> dict:
    sm = app.state.store_manager
    return {
        "status": "ok",
        "users": len(sm.list_users()),
        "cached_stores": len(sm._stores),
        "llm_enabled": bool(_llm_config()),
    }


# ----- daily scheduler -----
def _daily_scheduler():
    """Refresh dividend data + dashboard cache for all active stores at 6am daily.

    The dividend refresh picks up new dividend declarations from yfinance
    (e.g. when a company declares a new quarterly dividend overnight,
    including future ex-dates that yfinance has already published).
    The dashboard cache rebuild then propagates the updated values to the UI.
    """
    import datetime
    from datetime import timedelta
    while True:
        now = _time.time()
        today_6am = datetime.datetime.now().replace(hour=6, minute=0, second=0, microsecond=0)
        if datetime.datetime.now().hour >= 6:
            next_6am = today_6am + timedelta(days=1)
        else:
            next_6am = today_6am
        wait = (next_6am - datetime.datetime.now()).total_seconds()
        if wait > 0:
            _time.sleep(wait)
        try:
            # Iterate over ALL known users (not just currently-cached stores).
            # Stores are LRU-cached and only created on demand when a user
            # makes a request, so iterating `store_manager._stores` would
            # silently skip any user who wasn't logged in at 6am — meaning
            # their dashboard cache would stay stale until they next hit
            # "Refresh" manually. Touching each user via get_store() ensures
            # the scheduler refreshes everyone, even overnight.
            sm = app.state.store_manager
            for uid in sm.list_users():
                try:
                    store = sm.get_store(uid)
                    # Dividends: force=True so we bypass the 7-day negative
                    # cache and re-verify every symbol. This is what lets
                    # future / newly-declared dividends appear in the UI
                    # without waiting up to a week for the negative cache
                    # to expire. Price fetch still respects its TTL below.
                    try:
                        store.refresh_dividends(force=True)
                    except Exception as e:
                        logger.warning("Daily dividend refresh failed for user %s: %s", uid, e)
                    # Prices + cache rebuild with force=True so the
                    # scheduled 6am job actually pulls fresh yfinance data
                    # instead of reusing yesterday's SQLite price_cache.
                    # Manual "Refresh" also uses force=True; the per-request
                    # SQLite cache still avoids hitting yfinance on every
                    # page load.
                    store.rebuild_dashboard_cache(force=True)
                    # Pre-warm the networth history (the in-memory 24h cache
                    # was just invalidated by rebuild_dashboard_cache above).
                    # Doing it here means the user's first page load after
                    # 6am shows the chart instantly instead of waiting on
                    # a yfinance `yf.download` round-trip.
                    try:
                        store.get_networth_history()
                    except Exception as e:
                        logger.warning("Daily networth history pre-warm failed for user %s: %s", uid, e)
                except Exception as e:
                    logger.warning("Daily refresh failed for user %s: %s", uid, e)
            logger.info("Daily refresh completed")
        except Exception as e:
            logger.error("Daily refresh failed: %s", e)


# ----------------------------- portfolio routes -----------------------------

@app.get("/api/portfolio/summary")
def portfolio_summary(base_currency: str = "SGD", store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Portfolio summary. Serves from cache if available."""
    cached = store.get_dashboard_cache()
    if cached and cached.get("summary"):
        return cached["summary"]
    return store.get_summary(base_currency=base_currency)


@app.get("/api/portfolio/currency-breakdown")
def portfolio_currency_breakdown(base_currency: str = "SGD", store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Per-currency P&L table. Serves from cache if available."""
    cached = store.get_dashboard_cache()
    if cached and cached.get("breakdown"):
        return cached["breakdown"]
    try:
        store.refresh_prices()
    except Exception:
        pass
    return store.get_currency_breakdown(base_currency=base_currency)


@app.get("/api/portfolio/holdings")
def portfolio_holdings(refresh: bool = Query(False), store: PortfolioStore = Depends(get_user_store)) -> dict:
    if refresh:
        store.refresh_prices()
    return {
        "holdings": store.get_holdings(),
        "prices": store.get_prices(),
    }


@app.get("/api/portfolio/transactions")
def portfolio_transactions(symbol: Optional[str] = None,
                            market: Optional[str] = None,
                            store: PortfolioStore = Depends(get_user_store)) -> dict:
    txs = store.get_transactions()
    if symbol:
        txs = [t for t in txs if t["symbol"].upper() == symbol.upper()]
    if market:
        txs = [t for t in txs if resolve_symbol(t["symbol"], t["exchange"]).market == market]
    return {"transactions": txs, "count": len(txs)}


def _refresh_dashboard_cache(store: PortfolioStore) -> None:
    """Schedule a dashboard cache rebuild in a background thread."""
    def _run():
        try:
            store.rebuild_dashboard_cache(force=True)
        except Exception as e:
            logger.warning("dashboard cache rebuild failed: %s", e)
    t = threading.Thread(target=_run, daemon=True)
    t.start()


@app.post("/api/portfolio/transactions")
def portfolio_add_transaction(tx: TransactionInput, store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Add a single transaction. Automatically rebuilds FIFO and dividends for new symbols."""
    return store.add_transaction(tx.model_dump())


@app.put("/api/portfolio/transactions/{tx_id}")
def portfolio_update_transaction(tx_id: int, tx: TransactionInput, store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Update an existing transaction by ID. Rebuilds all derived data."""
    try:
        return store.update_transaction(tx_id, tx.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/portfolio/transactions/{symbol}")
def portfolio_delete_transactions(symbol: str, store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Delete all transactions for a given symbol. Rebuilds all derived data."""
    return store.delete_transactions_by_symbol(symbol.upper())


@app.delete("/api/portfolio/transactions/id/{tx_id}")
def portfolio_delete_transaction_by_id(tx_id: int, store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Delete a single transaction by ID. Rebuilds all derived data."""
    try:
        return store.delete_transaction(tx_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class BulkDeleteRequest(BaseModel):
    ids: list[int]


@app.post("/api/portfolio/transactions/bulk-delete")
def portfolio_bulk_delete_transactions(req: BulkDeleteRequest, store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Delete multiple transactions by ID in a single pass."""
    result = store.delete_transactions_by_ids(req.ids)
    _refresh_dashboard_cache(store)
    return result


@app.post("/api/portfolio/transactions/backfill-names")
def portfolio_backfill_transaction_names(store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Fetch and persist missing company names for all transactions (async)."""
    t = threading.Thread(target=store.backfill_transaction_names, daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/api/portfolio/roundtrips")
def portfolio_roundtrips(store: PortfolioStore = Depends(get_user_store)) -> dict:
    return {
        "roundtrips": store.get_roundtrips(),
        "profile": store.get_profile(),
    }


@app.get("/api/portfolio/dividends")
def portfolio_dividends(store: PortfolioStore = Depends(get_user_store)) -> dict:
    # Always serve fresh dividend data — new dividends can appear at any time
    # and the dashboard cache may be stale.
    return store.get_dividends()


@app.get("/api/portfolio/profile")
def portfolio_profile(store: PortfolioStore = Depends(get_user_store)) -> dict:
    cached = store.get_dashboard_cache()
    if cached and cached.get("profile"):
        return cached["profile"]
    return store.get_profile()


@app.get("/api/portfolio/fund-aliases")
def list_fund_aliases(store: PortfolioStore = Depends(get_user_store)) -> dict:
    return {"aliases": store.db.load_fund_aliases(store.user_id)}


class FundAliasInput(BaseModel):
    alias: str
    isin: str
    fund_name: str = ""


@app.post("/api/portfolio/fund-aliases")
def save_fund_alias(req: FundAliasInput, store: PortfolioStore = Depends(get_user_store)) -> dict:
    store.db.save_fund_alias(store.user_id, req.alias, req.isin, req.fund_name)
    return {"status": "ok"}


@app.delete("/api/portfolio/fund-aliases/{alias}")
def delete_fund_alias(alias: str, store: PortfolioStore = Depends(get_user_store)) -> dict:
    deleted = store.db.delete_fund_alias(store.user_id, alias)
    return {"deleted": deleted}


@app.post("/api/portfolio/upload")
async def portfolio_upload(request: Request, file: UploadFile = File(...),
                            store: PortfolioStore = Depends(get_user_store)) -> dict:
    MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
    # Validate Content-Type
    content_type = (file.content_type or "").lower()
    allowed_types = {"text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"}
    if content_type and content_type not in allowed_types:
        raise HTTPException(415, f"Unsupported file type: {content_type}. Please upload a CSV file.")
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
    chunks = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
        chunks.append(chunk)
    raw = b"".join(chunks)
    text: Optional[str] = None
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb2312"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise HTTPException(400, "Could not decode uploaded file")
    # Save the CSV to the user's directory
    user = store.user_id
    user_dir = DATA_DIR / "users" / user
    user_dir.mkdir(parents=True, exist_ok=True)
    csv_path = user_dir / "transactions.csv"
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write(text)
    result = store.load_csv_text(text)
    # warm prices
    try:
        store.refresh_prices()
    except Exception:
        pass
    return result


@app.post("/api/portfolio/cache/refresh")
def refresh_dashboard_cache(store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Refresh all live data (prices + dividends) and rebuild the dashboard cache.

    Single entry point for both the daily 6am scheduler and the manual
    "Refresh" button. Both pass `force=True` to bypass the SQLite
    price_cache TTL and the in-memory MarketDataService TTL so the cache
    is always fresh. The per-request cache still avoids hitting yfinance
    on every page load.

    Returns counts of what was updated.
    """
    result = store.rebuild_dashboard_cache(force=True)
    # Pre-warm the networth chart cache so the chart is instant on next load.
    try:
        store.get_networth_history()
    except Exception as e:
        logger.warning("Networth history pre-warm failed: %s", e)
    return {
        "holdings": result.get("holdings", 0),
        "prices_updated": result.get("prices_updated", 0),
        "dividends_refreshed": result.get("dividends_refreshed", 0),
        "dividend_events": result.get("dividend_events", 0),
    }


@app.get("/api/portfolio/cache/status")
def cache_status(store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Check dashboard cache age."""
    cached = store.get_dashboard_cache()
    if cached is None:
        return {"cached": False, "age_hours": None}
    age = _time.time() - cached.get("updated_at", 0)
    return {"cached": True, "age_hours": round(age / 3600, 1)}


@app.get("/api/portfolio/symbols/validate")
def validate_symbol(symbol: str, exchange: str = "USX", user: dict = Depends(get_current_user)) -> dict:
    """Check if a symbol is valid on yfinance. Returns valid + company name."""
    from .services.market_data import MarketDataService
    sm = app.state.store_manager
    # Use the user's store's market_data for consistency
    user_store = sm.get_store(user["id"])
    md = user_store.market_data
    sym = symbol.strip().upper()
    if not sym:
        return {"valid": False, "symbol": sym, "name": None}

    # For funds, try ISIN directly as ticker first
    if exchange == "FUND":
        q = md.get_quote(symbol=sym, yahoo_symbol=sym, market="fund", currency="SGD", use_cache=False)
        if q.price is not None or q.name:
            return {"valid": True, "symbol": sym, "name": q.name or "", "market": "fund", "yahoo_symbol": sym}
        # Fund not on yfinance — allow anyway (manual NAV)
        return {"valid": True, "symbol": sym, "name": None, "market": "fund", "yahoo_symbol": ""}

    try:
        res = resolve_symbol(sym, exchange)
        if not res or not res.yahoo_symbol:
            return {"valid": False, "symbol": sym, "name": None}
    except Exception:
        return {"valid": False, "symbol": sym, "name": None}
    q = md.get_quote(
        symbol=sym,
        yahoo_symbol=res.yahoo_symbol,
        market=res.market,
        currency="USD",
        use_cache=False,
    )
    if q.price is not None or q.name:
        return {"valid": True, "symbol": sym, "name": q.name or "", "market": res.market, "yahoo_symbol": res.yahoo_symbol}
    return {"valid": False, "symbol": sym, "name": None}


@app.get("/api/portfolio/dashboard")
def dashboard_data(store: PortfolioStore = Depends(get_user_store)) -> dict:
    """Serve all dashboard data from cache."""
    cached = store.get_dashboard_cache()
    if cached:
        if "benchmarks" not in cached:
            cached["benchmarks"] = store.get_benchmarks()
        return cached
    result = store.rebuild_dashboard_cache()
    return result["cache"]


@app.get("/api/portfolio/networth-history")
def portfolio_networth_history(
    refresh: bool = Query(False),
    store: PortfolioStore = Depends(get_user_store),
) -> dict:
    """Monthly net worth in base currency (SGD) for the last 12 months."""
    if refresh:
        store._invalidate_networth_cache()
    return store.get_networth_history()


@app.post("/api/portfolio/advice/stream")
async def portfolio_advice_stream(req: AdviceRequest, store: PortfolioStore = Depends(get_user_store)):
    """SSE-stream the LLM narrative as it arrives.

    Events:
      {"type": "thinking", "content": "..."}   — reasoning_content delta
      {"type": "content",  "content": "..."}   — main content delta
      {"type": "report",   "report": {...}}    — final AdviceReport
      {"type": "error",    "message": "..."}    — on failure (incl. fallback to rule-based)
    """
    from fastapi.responses import StreamingResponse
    from .services.advice import (
        generate_advice,
        stream_llm_narrative,
    )

    focus = (req.focus or "full").strip() or "full"
    custom_question = (req.custom_question or "").strip() or None

    async def event_gen():
        # Try the LLM first; fall back to rule-based if it fails.
        llm_cfg = _llm_config()
        thinking_parts: list = []
        content_parts: list = []
        llm_error: Optional[str] = None
        if llm_cfg and llm_cfg.get("api_key"):
            try:
                findings = compute_findings(
                    store.get_holdings(),
                    store.get_profile(),
                    store.dividend_summary,
                    store.get_prices_map(),
                )
                async for kind, text in stream_llm_narrative(
                    findings,
                    custom_question,
                    base_url=llm_cfg.get("base_url", "https://api.openai.com/v1"),
                    api_key=llm_cfg["api_key"],
                    model=llm_cfg.get("model", "gpt-4o-mini"),
                    focus=focus,
                ):
                    if kind == "thinking":
                        thinking_parts.append(text)
                        yield _sse("thinking", {"content": text})
                    elif kind == "content":
                        content_parts.append(text)
                        yield _sse("content", {"content": text})
            except Exception as e:
                logger.warning("LLM stream failed: %s", e)
                llm_error = str(e)
        else:
            llm_error = "no LLM API key configured"

        # If we got content, build the full report; otherwise fall back.
        if content_parts:
            full_content = "".join(content_parts)
            result = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "summary": _extract_summary(full_content),
                "sections": [],
                "risk_flags": [],
                "opportunities": [],
                "raw_markdown": full_content,
                "source": "llm",
            }
            # Augment with rule-based findings (for the side panels).
            try:
                findings = compute_findings(
                    store.get_holdings(),
                    store.get_profile(),
                    store.dividend_summary,
                    store.get_prices_map(),
                )
                result["risk_flags"] = findings["risk_flags"]
                result["opportunities"] = findings["opportunities"]
                result["sections"] = [
                    {"title": "Snapshot", "items": [
                        f"Open positions: {findings['summary_metrics']['holdings_count']}",
                        f"Market value: {findings['summary_metrics']['total_market_value']:,.2f}",
                    ]},
                ]
            except Exception:
                pass
            try:
                report = AdviceReport(**result).model_dump()
                store.save_advice_cache(focus, custom_question, report)
                yield _sse("report", {"report": report, "thinking": "".join(thinking_parts)})
            except Exception as e:
                logger.warning("failed to persist streamed report: %s", e)
                yield _sse("report", {"report": result, "thinking": "".join(thinking_parts)})
        else:
            # LLM failed — emit a rule-based fallback as a single event.
            try:
                result = await generate_advice(
                    holdings=store.get_holdings(),
                    profile=store.get_profile(),
                    dividends=store.dividend_summary,
                    prices=store.get_prices_map(),
                    focus=focus,
                    custom_question=custom_question,
                    llm_config=None,  # force rule-based
                )
                report = AdviceReport(
                    generated_at=result["generated_at"],
                    summary=result["summary"],
                    sections=result["sections"],
                    risk_flags=result["risk_flags"],
                    opportunities=result["opportunities"],
                    raw_markdown=result["raw_markdown"],
                    source=result["source"],
                ).model_dump()
                try:
                    store.save_advice_cache(focus, custom_question, report)
                except Exception:
                    pass
                yield _sse("report", {"report": report, "error": llm_error or "llm unavailable"})
            except Exception as e:
                logger.error("fallback report generation failed: %s", e)
                yield _sse("error", {"message": str(e)})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


def _sse(event: str, data: dict) -> str:
    import json as _json
    return f"event: {event}\ndata: {_json.dumps(data, default=str)}\n\n"


def _extract_summary(markdown: str) -> str:
    """Pull a one-line summary out of the LLM markdown."""
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("```"):
            continue
        clean = stripped.lstrip("#*- ").strip()
        if clean:
            return clean[:280]
    return ""


@app.post("/api/portfolio/advice", response_model=AdviceReport)
async def portfolio_advice(req: AdviceRequest, store: PortfolioStore = Depends(get_user_store)) -> dict:
    focus = (req.focus or "full").strip() or "full"
    custom_question = (req.custom_question or "").strip() or None

    # Serve cached report on subsequent calls so the LLM isn't hit every refresh.
    # Prefers the LLM slot, falls back to rule-based so the user never sees
    # a 60s spinner when the LLM proxy is slow.
    if not req.refresh:
        cached = store.get_advice_cache(focus, custom_question, prefer="llm")
        if cached is not None:
            return cached

    # Refresh prices in the background so the report reflects today's quotes
    # but never block on it (the LLM call dominates latency).
    try:
        store.refresh_prices()
    except Exception:
        pass

    result = await generate_advice(
        holdings=store.get_holdings(),
        profile=store.get_profile(),
        dividends=store.dividend_summary,
        prices=store.get_prices_map(),
        focus=focus,
        custom_question=custom_question,
        llm_config=_llm_config(),
    )
    report = AdviceReport(
        generated_at=result["generated_at"],
        summary=result["summary"],
        sections=result["sections"],
        risk_flags=result["risk_flags"],
        opportunities=result["opportunities"],
        raw_markdown=result["raw_markdown"],
        source=result["source"],
    ).model_dump()

    # Persist in the source-specific slot (LLM and rule-based are kept
    # separately so the rule-based fallback can survive independently).
    try:
        store.save_advice_cache(focus, custom_question, report)
    except Exception as e:
        logger.warning("failed to cache advice report: %s", e)

    return report


@app.get("/api/portfolio/markets")
def portfolio_markets() -> dict:
    return {
        "markets": [
            {"id": "us", "label": "US Equities"},
            {"id": "hk", "label": "HK Equities"},
            {"id": "uk", "label": "UK / LSE"},
            {"id": "sg", "label": "SG / SGX"},
            {"id": "sg_bond", "label": "SG Savings Bonds"},
            {"id": "cn", "label": "China A-Shares"},
            {"id": "cash", "label": "Cash"},
            {"id": "other", "label": "Other"},
        ]
    }
