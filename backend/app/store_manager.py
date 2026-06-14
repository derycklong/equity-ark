"""Manages per-user PortfolioStore instances with LRU eviction.

All stores share a single Database instance (data/portfolio.db).
Each PortfolioStore holds in-memory state for one user.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from .db import Database
from .store import PortfolioStore

logger = logging.getLogger(__name__)


class StoreManager:
    def __init__(self, db_path: str | Path, data_dir: str | Path, max_cached_users: int = 50):
        self.data_dir = Path(data_dir)
        self.db = Database(db_path)
        self.db.init()
        self.max_cached_users = max_cached_users
        self._stores: "OrderedDict[str, PortfolioStore]" = OrderedDict()
        self._lock = threading.RLock()

    def get_store(self, user_id: str) -> PortfolioStore:
        """Get or create the PortfolioStore for this user. LRU-cached."""
        with self._lock:
            if user_id in self._stores:
                self._stores.move_to_end(user_id)
                return self._stores[user_id]

            # Evict oldest if over capacity
            while len(self._stores) >= self.max_cached_users:
                evicted_id, evicted_store = self._stores.popitem(last=False)
                logger.info("Evicting store for user %s", evicted_id)

            store = PortfolioStore(db=self.db, user_id=user_id)
            self._stores[user_id] = store
            return store

    def invalidate(self, user_id: str) -> None:
        with self._lock:
            if user_id in self._stores:
                del self._stores[user_id]

    def list_users(self) -> list[str]:
        rows = self.db._conn().execute("SELECT id FROM users").fetchall()
        return [r[0] for r in rows]
