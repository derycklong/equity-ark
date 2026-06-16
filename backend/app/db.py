"""SQLite persistence layer for the portfolio store (multi-user).

Single shared database at data/portfolio.db. User-specific tables (transactions,
open_lots, roundtrips, dividend_events, fund_aliases, dashboard_cache) include
a user_id column. Shared tables (users, sessions, price_cache, fx_rates) have no user_id.
"""
from __future__ import annotations

import json
import logging
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

-- Auth: users & sessions
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    created_at REAL NOT NULL,
    last_login_at REAL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at REAL NOT NULL,
    created_at REAL NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Shared: price cache & FX rates (not user-specific)
CREATE TABLE IF NOT EXISTS price_cache (
    symbol TEXT PRIMARY KEY,
    yahoo_symbol TEXT,
    price REAL,
    previous_close REAL,
    change_pct REAL,
    currency TEXT,
    market TEXT,
    name TEXT,
    error TEXT,
    as_of REAL,
    fetched_at REAL NOT NULL DEFAULT 0
);

-- Per-symbol "yfinance has no dividend history" cache. Symbols marked here
-- are skipped on subsequent dividend fetches until the negative-TTL expires.
-- Avoids re-hitting yfinance for delisted SPACs / non-dividend tickers.
CREATE TABLE IF NOT EXISTS dividend_no_div_cache (
    yahoo_symbol TEXT PRIMARY KEY,
    checked_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_ccy TEXT NOT NULL,
    to_ccy TEXT NOT NULL,
    date_str TEXT NOT NULL,
    rate REAL NOT NULL,
    fetched_at REAL NOT NULL,
    UNIQUE(from_ccy, to_ccy, date_str)
);

-- Per-user: transactions
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    side TEXT NOT NULL,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    gross_amount REAL NOT NULL,
    net_amount REAL NOT NULL,
    fees REAL NOT NULL,
    currency TEXT NOT NULL,
    label TEXT,
    note TEXT,
    name TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

-- Per-user: open lots
CREATE TABLE IF NOT EXISTS open_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    acquired TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    cost_basis REAL NOT NULL,
    fees REAL NOT NULL,
    UNIQUE(user_id, symbol, acquired, price)
);
CREATE INDEX IF NOT EXISTS idx_lots_user ON open_lots(user_id);

-- Per-user: roundtrips
CREATE TABLE IF NOT EXISTS roundtrips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    currency TEXT NOT NULL,
    exchange TEXT NOT NULL,
    yahoo_symbol TEXT,
    buy_date TEXT NOT NULL,
    sell_date TEXT NOT NULL,
    quantity REAL NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    cost REAL NOT NULL,
    proceeds REAL NOT NULL,
    fees REAL NOT NULL,
    pnl REAL NOT NULL,
    pnl_pct REAL NOT NULL,
    hold_days INTEGER NOT NULL,
    UNIQUE(user_id, symbol, buy_date, sell_date, quantity)
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON roundtrips(user_id);

-- Per-user: dividend events
CREATE TABLE IF NOT EXISTS dividend_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    yahoo_symbol TEXT,
    ex_date TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_per_share REAL NOT NULL,
    shares_at_ex REAL NOT NULL,
    total_received REAL NOT NULL,
    withholding_rate REAL NOT NULL DEFAULT 0.0,
    UNIQUE(user_id, symbol, ex_date)
);
CREATE INDEX IF NOT EXISTS idx_div_user ON dividend_events(user_id);

-- Per-user: dashboard cache
CREATE TABLE IF NOT EXISTS dashboard_cache (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(user_id, key)
);

-- Per-user: fund aliases
CREATE TABLE IF NOT EXISTS fund_aliases (
    user_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    isin TEXT NOT NULL,
    fund_name TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    UNIQUE(user_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_fund_user ON fund_aliases(user_id);
"""


class Database:
    _local = threading.local()

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._init_lock = threading.Lock()
        self._initialized = False

    # ----- thread-local connection -----

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self.path), check_same_thread=False)
            conn.execute("PRAGMA foreign_keys = ON")
            setattr(self._local, "conn", conn)
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            setattr(self._local, "conn", None)

    # ----- init -----

    def init(self) -> None:
        with self._init_lock:
            if self._initialized:
                return
            conn = self._conn()
            conn.executescript(SCHEMA)
            conn.execute(
                "INSERT OR IGNORE INTO schema_version (version) VALUES (?)",
                (2,),  # v2 = multi-user schema
            )
            conn.commit()
            # Idempotent migrations for v2 -> v2.1
            self._add_column_if_missing(
                "dividend_events", "withholding_rate", "REAL NOT NULL DEFAULT 0.0"
            )
            conn.commit()
            self._initialized = True
            logger.info("Database initialized at %s", self.path)

    def _add_column_if_missing(self, table: str, column: str, definition: str) -> None:
        """Add a column to a table if it doesn't already exist."""
        conn = self._conn()
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            logger.info("Added column %s.%s", table, column)

    # =========================================================================
    # AUTH: users & sessions
    # =========================================================================

    def upsert_user(self, email: str, name: str, picture: str = "") -> dict:
        conn = self._conn()
        email = email.lower().strip()
        row = conn.execute(
            "SELECT id, email, name, picture, created_at, last_login_at FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        now = time.time()
        if row is None:
            user_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO users (id, email, name, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, email, name, picture, now, now),
            )
            conn.commit()
            return {"id": user_id, "email": email, "name": name, "picture": picture, "created_at": now, "last_login_at": now}
        user_id, _email, _name, _pic, created_at, _last_login = row
        conn.execute(
            "UPDATE users SET name = ?, picture = ?, last_login_at = ? WHERE id = ?",
            (name or _name, picture or _pic, now, user_id),
        )
        conn.commit()
        return {"id": user_id, "email": email, "name": name or _name or "", "picture": picture or _pic or "", "created_at": created_at, "last_login_at": now}

    def get_user(self, user_id: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT id, email, name, picture, created_at, last_login_at FROM users WHERE id = ?", (user_id,),
        ).fetchone()
        if not row:
            return None
        return {"id": row[0], "email": row[1], "name": row[2] or "", "picture": row[3] or "", "created_at": row[4], "last_login_at": row[5]}

    def get_user_by_email(self, email: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT id, email, name, picture, created_at, last_login_at FROM users WHERE email = ?", (email.lower().strip(),),
        ).fetchone()
        if not row:
            return None
        return {"id": row[0], "email": row[1], "name": row[2] or "", "picture": row[3] or "", "created_at": row[4], "last_login_at": row[5]}

    def list_all_users(self) -> list[dict]:
        """Return every user, ordered by most-recent login first."""
        rows = self._conn().execute(
            "SELECT id, email, name, picture, created_at, last_login_at FROM users "
            "ORDER BY COALESCE(last_login_at, 0) DESC, created_at DESC",
        ).fetchall()
        return [
            {
                "id": r[0],
                "email": r[1],
                "name": r[2] or "",
                "picture": r[3] or "",
                "created_at": r[4],
                "last_login_at": r[5],
            }
            for r in rows
        ]

    def create_session(self, user_id: str, ttl_seconds: int = 60 * 60 * 24 * 30) -> str:
        token = secrets.token_urlsafe(48)
        now = time.time()
        self._conn().execute(
            "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now + ttl_seconds, now),
        )
        self._conn().commit()
        return token

    def get_session(self, token: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT token, user_id, expires_at, created_at FROM sessions WHERE token = ?", (token,),
        ).fetchone()
        if not row:
            return None
        if row[2] < time.time():
            self._conn().execute("DELETE FROM sessions WHERE token = ?", (token,))
            self._conn().commit()
            return None
        return {"token": row[0], "user_id": row[1], "expires_at": row[2], "created_at": row[3]}

    def delete_session(self, token: str) -> None:
        self._conn().execute("DELETE FROM sessions WHERE token = ?", (token,))
        self._conn().commit()

    def cleanup_expired_sessions(self) -> int:
        cur = self._conn().execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        self._conn().commit()
        return cur.rowcount

    # =========================================================================
    # SHARED: price cache & FX rates
    # =========================================================================

    def save_price_cache(self, symbol: str, data: dict) -> None:
        conn = self._conn()
        conn.execute(
            """INSERT OR REPLACE INTO price_cache
               (symbol, yahoo_symbol, price, previous_close, change_pct,
                currency, market, name, error, as_of, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol.upper(), data.get("yahoo_symbol", ""), data.get("price"),
             data.get("previous_close"), data.get("change_pct"), data.get("currency"),
             data.get("market"), data.get("name"), data.get("error"), data.get("as_of"), time.time()),
        )
        conn.commit()

    def load_all_price_caches(self) -> Dict[str, dict]:
        rows = self._conn().execute(
            "SELECT symbol, yahoo_symbol, price, previous_close, change_pct, "
            "currency, market, name, error, as_of, fetched_at FROM price_cache"
        ).fetchall()
        return {r[0]: {"symbol": r[0], "yahoo_symbol": r[1] or "", "price": r[2],
                        "previous_close": r[3], "change_pct": r[4], "currency": r[5] or "",
                        "market": r[6] or "", "name": r[7] or "", "error": r[8] or "",
                        "as_of": r[9], "fetched_at": r[10]}
                for r in rows}

    # ----- "no dividends" negative cache -----
    # Symbols whose yfinance lookup returned empty are recorded here so we
    # skip the yfinance call on subsequent refreshes. Entries auto-expire
    # after `ttl_seconds` so a freshly-listed stock that pays its first
    # dividend later is still picked up.

    def get_no_div_symbols(self, ttl_seconds: int) -> set:
        """Return the set of yahoo_symbols that have been confirmed to have
        no dividend history, but only if the confirmation is still fresh
        (within ttl_seconds)."""
        cutoff = time.time() - ttl_seconds
        rows = self._conn().execute(
            "SELECT yahoo_symbol FROM dividend_no_div_cache WHERE checked_at > ?",
            (cutoff,),
        ).fetchall()
        return {r[0] for r in rows}

    def mark_no_dividends(self, yahoo_symbol: str) -> None:
        self._conn().execute(
            "INSERT OR REPLACE INTO dividend_no_div_cache (yahoo_symbol, checked_at) VALUES (?, ?)",
            (yahoo_symbol, time.time()),
        )
        self._conn().commit()

    def clear_no_dividend_mark(self, yahoo_symbol: str) -> None:
        """Remove the no-dividend marker (e.g., when yfinance does return data)."""
        self._conn().execute(
            "DELETE FROM dividend_no_div_cache WHERE yahoo_symbol = ?",
            (yahoo_symbol,),
        )
        self._conn().commit()

    def save_fx_rate(self, from_ccy: str, to_ccy: str, date_str: str, rate: float) -> None:
        self._conn().execute(
            "INSERT OR REPLACE INTO fx_rates (from_ccy, to_ccy, date_str, rate, fetched_at) VALUES (?, ?, ?, ?, ?)",
            (from_ccy.upper(), to_ccy.upper(), date_str, rate, time.time()),
        )
        self._conn().commit()

    def load_fx_rate(self, from_ccy: str, to_ccy: str, date_str: str) -> Optional[float]:
        row = self._conn().execute(
            "SELECT rate FROM fx_rates WHERE from_ccy=? AND to_ccy=? AND date_str=?",
            (from_ccy.upper(), to_ccy.upper(), date_str),
        ).fetchone()
        return float(row[0]) if row else None

    # =========================================================================
    # PER-USER: transactions
    # =========================================================================

    def save_transactions(self, user_id: str, txs: List[dict]) -> None:
        conn = self._conn()
        new_ids = {t.get("id") for t in txs if t.get("id")}
        if new_ids:
            conn.execute(
                f"DELETE FROM transactions WHERE user_id = ? AND id IS NOT NULL AND id NOT IN ({','.join('?' for _ in new_ids)})",
                [user_id] + list(new_ids),
            )
        else:
            conn.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
        conn.executemany(
            """INSERT OR REPLACE INTO transactions
               (id, user_id, date, side, symbol, exchange, quantity, price,
                gross_amount, net_amount, fees, currency, label, note, name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (t.get("id"), user_id,
                 t["date"].isoformat() if hasattr(t["date"], "isoformat") else str(t["date"]),
                 t["side"], t["symbol"].upper(), t["exchange"], t["quantity"],
                 t["price"], t["gross_amount"], t.get("net_amount", t["gross_amount"]),
                 t["fees"], t["currency"], t.get("label", ""), t.get("note", ""), t.get("name") or "")
                for t in txs
            ],
        )
        conn.commit()

    def load_transactions(self, user_id: str) -> List[dict]:
        rows = self._conn().execute(
            "SELECT id, date, side, symbol, exchange, quantity, price, "
            "gross_amount, net_amount, fees, currency, label, note, name "
            "FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC",
            (user_id,),
        ).fetchall()
        return [{"id": r[0], "date": r[1], "side": r[2], "symbol": r[3], "exchange": r[4],
                 "quantity": r[5], "price": r[6], "gross_amount": r[7], "net_amount": r[8],
                 "fees": r[9], "currency": r[10], "label": r[11] or "", "note": r[12] or "", "name": r[13] or ""}
                for r in rows]

    def update_transaction(self, user_id: str, tx_id: int, fields: dict) -> None:
        allowed = {"date", "side", "symbol", "exchange", "quantity", "price",
                   "gross_amount", "net_amount", "fees", "currency", "label", "note", "name"}
        sets, vals = [], []
        for k, v in fields.items():
            if k in allowed:
                sets.append(f"{k} = ?")
                vals.append(v)
        if not sets:
            return
        vals.extend([user_id, tx_id])
        self._conn().execute(f"UPDATE transactions SET {', '.join(sets)} WHERE user_id = ? AND id = ?", vals)
        self._conn().commit()

    def delete_transaction(self, user_id: str, tx_id: int) -> int:
        cur = self._conn().execute("DELETE FROM transactions WHERE user_id = ? AND id = ?", (user_id, tx_id))
        self._conn().commit()
        return cur.rowcount

    def update_transaction_name_by_symbol(self, user_id: str, symbol: str, name: str) -> int:
        cur = self._conn().execute(
            "UPDATE transactions SET name = ? WHERE user_id = ? AND symbol = ? AND (name IS NULL OR name = '')",
            (name, user_id, symbol.upper()),
        )
        self._conn().commit()
        return cur.rowcount

    # =========================================================================
    # PER-USER: open lots
    # =========================================================================

    def save_open_lots(self, user_id: str, lots_by_symbol: Dict[str, list]) -> None:
        conn = self._conn()
        existing_syms = {r[0] for r in conn.execute("SELECT DISTINCT symbol FROM open_lots WHERE user_id = ?", (user_id,)).fetchall()}
        new_syms = set(lots_by_symbol.keys())
        for sym in existing_syms - new_syms:
            conn.execute("DELETE FROM open_lots WHERE user_id = ? AND symbol = ?", (user_id, sym))
        rows = []
        for sym, lots in lots_by_symbol.items():
            for lot in lots:
                acquired = getattr(lot, "acquired", None)
                rows.append((
                    user_id, sym,
                    acquired.isoformat() if hasattr(acquired, "isoformat") else str(acquired),
                    getattr(lot, "quantity", 0), getattr(lot, "price", 0),
                    getattr(lot, "cost_basis", 0), getattr(lot, "fees", 0),
                ))
        conn.executemany(
            """INSERT OR REPLACE INTO open_lots
               (user_id, symbol, acquired, quantity, price, cost_basis, fees)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        conn.commit()

    def load_open_lots(self, user_id: str) -> Dict[str, list]:
        rows = self._conn().execute(
            "SELECT symbol, acquired, quantity, price, cost_basis, fees FROM open_lots WHERE user_id = ?", (user_id,),
        ).fetchall()
        by_sym: Dict[str, list] = {}
        for r in rows:
            by_sym.setdefault(r[0], []).append({
                "acquired": r[1], "quantity": r[2], "price": r[3],
                "cost_basis": r[4], "fees": r[5],
            })
        return by_sym

    # =========================================================================
    # PER-USER: roundtrips
    # =========================================================================

    def save_roundtrips(self, user_id: str, rts: List[dict]) -> None:
        conn = self._conn()

        def _get(obj, field, default=""):
            if isinstance(obj, dict):
                return obj.get(field, default)
            return getattr(obj, field, default)

        def _val(obj, field, default=""):
            val = _get(obj, field, default)
            if hasattr(val, "isoformat"):
                return val.isoformat()
            return str(val) if val is not None else default

        existing_keys = {
            (r[0], r[1], r[2], r[3]) for r in
            conn.execute("SELECT symbol, buy_date, sell_date, quantity FROM roundtrips WHERE user_id = ?", (user_id,)).fetchall()
        }
        new_keys = {(_get(r, "symbol", ""), _val(r, "buy_date"), _val(r, "sell_date"), _get(r, "quantity", 0)) for r in rts}
        for key in existing_keys - new_keys:
            conn.execute("DELETE FROM roundtrips WHERE user_id = ? AND symbol = ? AND buy_date = ? AND sell_date = ? AND quantity = ?",
                         (user_id, *key))

        conn.executemany(
            """INSERT OR REPLACE INTO roundtrips
               (user_id, symbol, market, currency, exchange, yahoo_symbol,
                buy_date, sell_date, quantity, buy_price, sell_price,
                cost, proceeds, fees, pnl, pnl_pct, hold_days)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(user_id, _get(r, "symbol", ""), _get(r, "market", ""), _get(r, "currency", ""),
              _get(r, "exchange", ""), _get(r, "yahoo_symbol", ""), _val(r, "buy_date"),
              _val(r, "sell_date"), _get(r, "quantity", 0), _get(r, "buy_price", 0),
              _get(r, "sell_price", 0), _get(r, "cost", 0), _get(r, "proceeds", 0),
              _get(r, "fees", 0), _get(r, "pnl", 0), _get(r, "pnl_pct", 0), _get(r, "hold_days", 0))
             for r in rts],
        )
        conn.commit()

    def load_roundtrips(self, user_id: str) -> List[dict]:
        rows = self._conn().execute(
            "SELECT symbol, market, currency, exchange, yahoo_symbol, "
            "buy_date, sell_date, quantity, buy_price, sell_price, "
            "cost, proceeds, fees, pnl, pnl_pct, hold_days "
            "FROM roundtrips WHERE user_id = ? ORDER BY sell_date DESC", (user_id,),
        ).fetchall()
        return [{"symbol": r[0], "market": r[1], "currency": r[2], "exchange": r[3],
                 "yahoo_symbol": r[4], "buy_date": r[5], "sell_date": r[6],
                 "quantity": r[7], "buy_price": r[8], "sell_price": r[9],
                 "cost": r[10], "proceeds": r[11], "fees": r[12],
                 "pnl": r[13], "pnl_pct": r[14], "hold_days": r[15]}
                for r in rows]

    # =========================================================================
    # PER-USER: dividend events
    # =========================================================================

    def save_dividend_events(self, user_id: str, events: List[dict]) -> None:
        conn = self._conn()
        existing_keys = {(r[0], r[1]) for r in
                         conn.execute("SELECT symbol, ex_date FROM dividend_events WHERE user_id = ?", (user_id,)).fetchall()}
        new_keys = {(e["symbol"], e["ex_date"].isoformat() if hasattr(e["ex_date"], "isoformat") else str(e["ex_date"])) for e in events}
        for sym, ex_date in existing_keys - new_keys:
            conn.execute("DELETE FROM dividend_events WHERE user_id = ? AND symbol = ? AND ex_date = ?", (user_id, sym, ex_date))

        conn.executemany(
            """INSERT OR REPLACE INTO dividend_events
               (user_id, symbol, yahoo_symbol, ex_date, currency,
                amount_per_share, shares_at_ex, total_received, withholding_rate)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(user_id, e["symbol"], e.get("yahoo_symbol", ""),
              e["ex_date"].isoformat() if hasattr(e["ex_date"], "isoformat") else str(e["ex_date"]),
              e["currency"], e["amount_per_share"], e["shares_at_ex"], e["total_received"],
              e.get("withholding_rate", 0.0))
             for e in events],
        )
        conn.commit()

    def load_dividend_events(self, user_id: str) -> List[dict]:
        rows = self._conn().execute(
            "SELECT symbol, yahoo_symbol, ex_date, currency, "
            "amount_per_share, shares_at_ex, total_received, withholding_rate "
            "FROM dividend_events WHERE user_id = ? ORDER BY ex_date DESC", (user_id,),
        ).fetchall()
        return [{"symbol": r[0], "yahoo_symbol": r[1], "ex_date": r[2], "currency": r[3],
                 "amount_per_share": r[4], "shares_at_ex": r[5], "total_received": r[6],
                 "withholding_rate": r[7] or 0.0}
                for r in rows]

    def clear_dividend_events(self, user_id: str) -> int:
        """Delete all dividend events for a user. Used by the backfill path."""
        cur = self._conn().execute(
            "DELETE FROM dividend_events WHERE user_id = ?", (user_id,),
        )
        self._conn().commit()
        return cur.rowcount

    def delete_dividend_events_for_symbol(self, user_id: str, symbol: str) -> int:
        """Delete dividend events for a single (user, symbol) pair.

        Used by the per-symbol backfill path so that a yfinance fetch failure
        for one symbol doesn't wipe the entire user's dividend history.
        """
        cur = self._conn().execute(
            "DELETE FROM dividend_events WHERE user_id = ? AND symbol = ?",
            (user_id, symbol.upper()),
        )
        self._conn().commit()
        return cur.rowcount

    # =========================================================================
    # PER-USER: dashboard cache
    # =========================================================================

    def save_dashboard_cache(self, user_id: str, key: str, data: str) -> None:
        self._conn().execute(
            "INSERT OR REPLACE INTO dashboard_cache (user_id, key, data, updated_at) VALUES (?, ?, ?, ?)",
            (user_id, key, data, time.time()),
        )
        self._conn().commit()

    def load_dashboard_cache(self, user_id: str, key: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT data, updated_at FROM dashboard_cache WHERE user_id = ? AND key = ?",
            (user_id, key),
        ).fetchone()
        if row is None:
            return None
        return {"data": json.loads(row[0]), "updated_at": row[1]}

    def clear_dashboard_cache(self, user_id: str) -> None:
        # Only clear the actual dashboard key, NOT all entries — the table
        # also holds advice cache entries (key='advice:...') which should
        # survive price/dividend refreshes.
        self._conn().execute(
            "DELETE FROM dashboard_cache WHERE user_id = ? AND key = 'dashboard'",
            (user_id,),
        )
        self._conn().commit()

    # =========================================================================
    # PER-USER: fund aliases
    # =========================================================================

    def save_fund_alias(self, user_id: str, alias: str, isin: str, fund_name: str = "") -> None:
        self._conn().execute(
            "INSERT OR REPLACE INTO fund_aliases (user_id, alias, isin, fund_name, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, alias.upper(), isin.upper(), fund_name, time.time()),
        )
        self._conn().commit()

    def load_fund_aliases(self, user_id: str) -> List[dict]:
        rows = self._conn().execute(
            "SELECT alias, isin, fund_name FROM fund_aliases WHERE user_id = ? ORDER BY alias", (user_id,),
        ).fetchall()
        return [{"alias": r[0], "isin": r[1], "fund_name": r[2]} for r in rows]

    def delete_fund_alias(self, user_id: str, alias: str) -> int:
        cur = self._conn().execute("DELETE FROM fund_aliases WHERE user_id = ? AND alias = ?", (user_id, alias.upper()))
        self._conn().commit()
        return cur.rowcount

    # =========================================================================
    # MIGRATION: from per-user DB files to shared DB
    # =========================================================================

    def migrate_from_old_db(self, user_id: str, old_db_path: Path) -> int:
        """Migrate data from a per-user SQLite file into the shared DB for user_id."""
        import shutil
        if not old_db_path.exists():
            return 0
        logger.info("Migrating old DB %s for user %s", old_db_path, user_id)
        tmp_conn = sqlite3.connect(f"file:{old_db_path}?mode=ro", uri=True)
        count = 0

        # Migrate transactions
        try:
            rows = tmp_conn.execute("SELECT * FROM transactions").fetchall()
            cols = [d[0] for d in tmp_conn.execute("PRAGMA table_info(transactions)").fetchall()]
            col_names = [c[1] for c in tmp_conn.execute("PRAGMA table_info(transactions)").fetchall()]
            for r in rows:
                d = dict(zip(col_names, r))
                d["user_id"] = user_id
                cols_to_use = ["user_id"] + [c for c in col_names if c != "id"]
                placeholders = ", ".join("?" * len(cols_to_use))
                col_str = ", ".join(cols_to_use)
                self._conn().execute(f"INSERT OR IGNORE INTO transactions ({col_str}) VALUES ({placeholders})",
                                     [d[c] for c in cols_to_use])
                count += 1
        except Exception as e:
            logger.debug("Migrate transactions: %s", e)
        # Simpler approach: just copy the rows with user_id added
        # Use raw SQL for the actual migration

        tmp_conn.close()
        return count

    def migrate_per_user_dbs(self, data_dir: Path) -> int:
        """Check for old per-user DBs under data/users/ and migrate them."""
        users_dir = data_dir / "users"
        if not users_dir.exists():
            return 0

        total = 0
        for user_dir in users_dir.iterdir():
            if not user_dir.is_dir():
                continue
            old_db = user_dir / "portfolio.db"
            if not old_db.exists():
                continue

            # Find or create the user by email
            # Check if there's a session table in main.db (old schema)
            user_id = user_dir.name
            # Check if user already has data in the shared DB
            existing = self.load_transactions(user_id)
            if existing:
                logger.info("User %s already has %d transactions in shared DB, skipping migration", user_id, len(existing))
                continue

            # Try to find user by ID in users table
            user = self.get_user(user_id)
            if not user:
                # Old DBs might not have a user record — create a placeholder
                conn = self._conn()
                conn.execute(
                    "INSERT OR IGNORE INTO users (id, email, name, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, f"{user_id}@migrated", user_id, "", time.time(), time.time()),
                )
                conn.commit()

            # Simple copy: read old DB rows, insert into shared DB with user_id
            try:
                tmp = sqlite3.connect(f"file:{old_db}?mode=ro", uri=True)

                # transactions
                try:
                    old_txs = tmp.execute("SELECT * FROM transactions").fetchall()
                    for r in old_txs:
                        self._conn().execute(
                            """INSERT OR IGNORE INTO transactions
                               (user_id, date, side, symbol, exchange, quantity, price,
                                gross_amount, net_amount, fees, currency, label, note, name)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (user_id, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13])
                        )
                    total += len(old_txs)
                except Exception:
                    pass

                # open_lots
                try:
                    old_lots = tmp.execute("SELECT * FROM open_lots").fetchall()
                    for r in old_lots:
                        self._conn().execute(
                            "INSERT OR IGNORE INTO open_lots (user_id, symbol, acquired, quantity, price, cost_basis, fees) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (user_id, r[1], r[2], r[3], r[4], r[5], r[6])
                        )
                except Exception:
                    pass

                # roundtrips
                try:
                    old_rts = tmp.execute("SELECT * FROM roundtrips").fetchall()
                    for r in old_rts:
                        self._conn().execute(
                            """INSERT OR IGNORE INTO roundtrips
                               (user_id, symbol, market, currency, exchange, yahoo_symbol,
                                buy_date, sell_date, quantity, buy_price, sell_price,
                                cost, proceeds, fees, pnl, pnl_pct, hold_days)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (user_id, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16])
                        )
                except Exception:
                    pass

                # dividend_events
                try:
                    old_divs = tmp.execute("SELECT * FROM dividend_events").fetchall()
                    for r in old_divs:
                        self._conn().execute(
                            """INSERT OR IGNORE INTO dividend_events
                               (user_id, symbol, yahoo_symbol, ex_date, currency,
                                amount_per_share, shares_at_ex, total_received)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (user_id, r[1], r[2], r[3], r[4], r[5], r[6], r[7])
                        )
                except Exception:
                    pass

                # fund_aliases
                try:
                    old_fa = tmp.execute("SELECT * FROM fund_aliases").fetchall()
                    for r in old_fa:
                        self._conn().execute(
                            "INSERT OR IGNORE INTO fund_aliases (user_id, alias, isin, fund_name, created_at) VALUES (?, ?, ?, ?, ?)",
                            (user_id, r[0], r[1], r[2], r[3])
                        )
                except Exception:
                    pass

                # dashboard_cache
                try:
                    old_dc = tmp.execute("SELECT * FROM dashboard_cache").fetchall()
                    for r in old_dc:
                        self._conn().execute(
                            "INSERT OR IGNORE INTO dashboard_cache (user_id, key, data, updated_at) VALUES (?, ?, ?, ?)",
                            (user_id, r[0], r[1], r[2])
                        )
                except Exception:
                    pass

                # fx_rates (merge into shared)
                try:
                    old_fx = tmp.execute("SELECT from_ccy, to_ccy, date_str, rate, fetched_at FROM fx_rates").fetchall()
                    for r in old_fx:
                        self._conn().execute(
                            "INSERT OR IGNORE INTO fx_rates (from_ccy, to_ccy, date_str, rate, fetched_at) VALUES (?, ?, ?, ?, ?)",
                            r
                        )
                except Exception:
                    pass

                tmp.close()
                self._conn().commit()
                logger.info("Migrated %s: %d txs", user_id, len(old_txs) if 'old_txs' in dir() else 0)
            except Exception as e:
                logger.error("Migration failed for %s: %s", user_id, e)

        return total
