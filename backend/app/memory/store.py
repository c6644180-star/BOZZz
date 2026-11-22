"""Identity-scoped SQLite repository for user-approved BOZZ memory facts."""

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
    """All reads and writes are fenced by a local owner and active identity."""

    LEGACY_IDENTITY = "__default__"

    def __init__(
        self,
        database: Database,
        owner_id: str = "local_user",
        identity_id: str = LEGACY_IDENTITY,
    ):
        self._db = database
        self.owner_id = str(owner_id)
        self.identity_id = str(identity_id)
        self._db.initialize()
        self._migrate_scope()

    def _migrate_scope(self) -> None:
        with self._db.transaction() as connection:
            connection.executescript(_SCHEMA)
            fact_columns = {row["name"] for row in connection.execute("PRAGMA table_info(memory_facts)")}
            if "owner_id" not in fact_columns:
                connection.execute("ALTER TABLE memory_facts ADD COLUMN owner_id TEXT")
            if "identity_id" not in fact_columns:
                connection.execute("ALTER TABLE memory_facts ADD COLUMN identity_id TEXT")

            # Existing installations were single-user and had no identity field.
            # Their records are assigned once to the current active identity.
            connection.execute(
                """UPDATE memory_facts SET owner_id = ?, identity_id = ?
                   WHERE owner_id IS NULL OR identity_id IS NULL""",
                (self.owner_id, self.identity_id),
            )

            setting_columns = {row["name"] for row in connection.execute("PRAGMA table_info(memory_settings)")}
            if "owner_id" not in setting_columns or "identity_id" not in setting_columns:
                connection.execute("ALTER TABLE memory_settings RENAME TO memory_settings_legacy")
                connection.execute(
                    """CREATE TABLE memory_settings (
                        owner_id TEXT NOT NULL,
                        identity_id TEXT NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT NOT NULL,
                        PRIMARY KEY (owner_id, identity_id, key)
                    )"""
                )
                connection.execute(
                    """INSERT OR IGNORE INTO memory_settings (owner_id, identity_id, key, value)
                       SELECT ?, ?, key, value FROM memory_settings_legacy""",
                    (self.owner_id, self.identity_id),
                )
                connection.execute("DROP TABLE memory_settings_legacy")
            connection.execute(
                """CREATE INDEX IF NOT EXISTS idx_memory_facts_scope_created
                   ON memory_facts(owner_id, identity_id, created_at DESC)"""
            )

            # If an installation was first used before an identity existed,
            # move that one legacy scope to the owner's first selected identity.
            if self.identity_id != self.LEGACY_IDENTITY:
                connection.execute(
                    """UPDATE memory_facts SET identity_id = ?
                       WHERE owner_id = ? AND identity_id = ?""",
                    (self.identity_id, self.owner_id, self.LEGACY_IDENTITY),
                )
                connection.execute(
                    """UPDATE memory_settings SET identity_id = ?
                       WHERE owner_id = ? AND identity_id = ?""",
                    (self.identity_id, self.owner_id, self.LEGACY_IDENTITY),
                )

    def list_facts(self, query: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        params: list[Any] = [self.owner_id, self.identity_id]
        where = "owner_id = ? AND identity_id = ?"
        if query:
            where += " AND LOWER(text) LIKE ?"
            params.append(f"%{query.lower().replace('%', '').replace('_', '')}%")
        params.append(limit)
        with self._db.read() as connection:
            rows = connection.execute(
                f"SELECT * FROM memory_facts WHERE {where} ORDER BY created_at DESC, id DESC LIMIT ?",
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def get_fact(self, fact_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute(
                """SELECT * FROM memory_facts
                   WHERE id = ? AND owner_id = ? AND identity_id = ?""",
                (fact_id, self.owner_id, self.identity_id),
            ).fetchone()
        return dict(row) if row else None

    def count(self) -> int:
        with self._db.read() as connection:
            return int(connection.execute(
                "SELECT COUNT(*) FROM memory_facts WHERE owner_id = ? AND identity_id = ?",
                (self.owner_id, self.identity_id),
            ).fetchone()[0])

    def has_text(self, text: str) -> bool:
        with self._db.read() as connection:
            row = connection.execute(
                """SELECT 1 FROM memory_facts
                   WHERE owner_id = ? AND identity_id = ? AND LOWER(text) = LOWER(?) LIMIT 1""",
                (self.owner_id, self.identity_id, text),
            ).fetchone()
        return row is not None

    def add_fact(self, fact_id: str, text: str, source: str, now: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """INSERT INTO memory_facts
                   (id, text, source, created_at, updated_at, owner_id, identity_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (fact_id, text, source, now, now, self.owner_id, self.identity_id),
            )

    def update_fact(self, fact_id: str, text: str, now: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                """UPDATE memory_facts SET text = ?, updated_at = ?
                   WHERE id = ? AND owner_id = ? AND identity_id = ?""",
                (text, now, fact_id, self.owner_id, self.identity_id),
            )
        return cursor.rowcount > 0

    def delete_fact(self, fact_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                """DELETE FROM memory_facts
                   WHERE id = ? AND owner_id = ? AND identity_id = ?""",
                (fact_id, self.owner_id, self.identity_id),
            )
        return cursor.rowcount > 0

    def clear(self) -> int:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM memory_facts WHERE owner_id = ? AND identity_id = ?",
                (self.owner_id, self.identity_id),
            )
        return cursor.rowcount

    def get_setting(self, key: str) -> str | None:
        with self._db.read() as connection:
            row = connection.execute(
                """SELECT value FROM memory_settings
                   WHERE owner_id = ? AND identity_id = ? AND key = ?""",
                (self.owner_id, self.identity_id, key),
            ).fetchone()
        return row["value"] if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """INSERT INTO memory_settings (owner_id, identity_id, key, value)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(owner_id, identity_id, key)
                   DO UPDATE SET value = excluded.value""",
                (self.owner_id, self.identity_id, key, value),
            )
