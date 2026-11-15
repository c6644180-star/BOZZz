"""SQLite repository for user-approved BOZZ memory facts.

Only text the user explicitly asked BOZZ to remember is stored here. The table
is created by this store (``CREATE TABLE IF NOT EXISTS``) so the shared schema
version does not change.
"""

from __future__ import annotations

from typing import Any

from app.db.database import Database

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memory_facts (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_created ON memory_facts(created_at DESC);

CREATE TABLE IF NOT EXISTS memory_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class MemoryStore:
    def __init__(self, database: Database):
        self._db = database
        self._db.initialize()
        with self._db.transaction() as connection:
            connection.executescript(_SCHEMA)

    def list_facts(self, query: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        with self._db.read() as connection:
            if query:
                like = f"%{query.lower().replace('%', '').replace('_', '')}%"
                rows = connection.execute(
                    "SELECT * FROM memory_facts WHERE LOWER(text) LIKE ? ORDER BY created_at DESC, id DESC LIMIT ?",
                    (like, limit),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM memory_facts ORDER BY created_at DESC, id DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [dict(row) for row in rows]

    def get_fact(self, fact_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT * FROM memory_facts WHERE id = ?", (fact_id,)).fetchone()
        return dict(row) if row else None

    def count(self) -> int:
        with self._db.read() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM memory_facts").fetchone()[0])

    def has_text(self, text: str) -> bool:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT 1 FROM memory_facts WHERE LOWER(text) = LOWER(?) LIMIT 1", (text,)
            ).fetchone()
        return row is not None

    def add_fact(self, fact_id: str, text: str, source: str, now: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                "INSERT INTO memory_facts (id, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (fact_id, text, source, now, now),
            )

    def update_fact(self, fact_id: str, text: str, now: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "UPDATE memory_facts SET text = ?, updated_at = ? WHERE id = ?", (text, now, fact_id)
            )
        return cursor.rowcount > 0

    def delete_fact(self, fact_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute("DELETE FROM memory_facts WHERE id = ?", (fact_id,))
        return cursor.rowcount > 0

    def clear(self) -> int:
        with self._db.transaction() as connection:
            cursor = connection.execute("DELETE FROM memory_facts")
        return cursor.rowcount

    def get_setting(self, key: str) -> str | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT value FROM memory_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                "INSERT INTO memory_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
