"""SQLite repositories for local BCI conversations, drafts, style and settings."""

from __future__ import annotations

from typing import Any, Iterable
import json

from app.db.database import Database


class BciStore:
    def __init__(self, database: Database):
        self._db = database
        self._db.initialize()

    # --------------------------------------------------------- conversations
    def list_conversations(self, limit: int = 200) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT c.id, c.title, c.source, c.retention_days, c.created_at, c.updated_at,
                       COUNT(m.id) AS messages_count,
                       COALESCE(SUM(LENGTH(m.text)), 0) AS char_count,
                       MAX(m.sent_at) AS last_message_at
                FROM bci_conversations c
                LEFT JOIN bci_messages m ON m.conversation_id = c.id
                GROUP BY c.id
                ORDER BY COALESCE(MAX(m.sent_at), c.updated_at) DESC
                LIMIT ?
                """,
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT * FROM bci_conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
        return dict(row) if row else None

    def create_conversation(
        self,
        conversation_id: str,
        title: str,
        source: str,
        retention_days: int,
        created_at: str,
        messages: Iterable[dict[str, Any]],
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO bci_conversations(id, title, source, retention_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (conversation_id, title, source, retention_days, created_at, created_at),
            )
            connection.executemany(
                """
                INSERT INTO bci_messages(id, conversation_id, sender, text, direction, sent_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item["id"],
                        conversation_id,
                        item["sender"],
                        item["text"],
                        item["direction"],
                        item["sent_at"],
                        created_at,
                    )
                    for item in messages
                ],
            )

    def update_conversation(
        self,
        conversation_id: str,
        *,
        title: str | None,
        retention_days: int | None,
        updated_at: str,
    ) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE bci_conversations
                SET title = COALESCE(?, title),
                    retention_days = COALESCE(?, retention_days),
                    updated_at = ?
                WHERE id = ?
                """,
                (title, retention_days, updated_at, conversation_id),
            )
            return cursor.rowcount > 0

    def delete_conversation(self, conversation_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM bci_conversations WHERE id = ?", (conversation_id,)
            )
            return cursor.rowcount > 0

    def delete_all_conversations(self) -> int:
        with self._db.transaction() as connection:
            cursor = connection.execute("DELETE FROM bci_conversations")
            return cursor.rowcount

    # -------------------------------------------------------------- messages
    def list_messages(self, conversation_id: str) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT id, conversation_id, sender, text, direction, sent_at, created_at
                FROM bci_messages WHERE conversation_id = ?
                ORDER BY sent_at ASC, rowid ASC
                """,
                (conversation_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    # ---------------------------------------------------------------- drafts
    def list_drafts(self, conversation_id: str) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT id, conversation_id, text, language, tone, created_at, updated_at
                FROM bci_drafts WHERE conversation_id = ?
                ORDER BY updated_at DESC
                """,
                (conversation_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_draft(self, draft_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT * FROM bci_drafts WHERE id = ?", (draft_id,)).fetchone()
        return dict(row) if row else None

    def create_draft(
        self,
        draft_id: str,
        conversation_id: str,
        text: str,
        language: str,
        tone: str,
        created_at: str,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO bci_drafts(id, conversation_id, text, language, tone, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (draft_id, conversation_id, text, language, tone, created_at, created_at),
            )

    def update_draft(
        self,
        draft_id: str,
        *,
        text: str | None,
        language: str | None,
        tone: str | None,
        updated_at: str,
    ) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE bci_drafts
                SET text = COALESCE(?, text),
                    language = COALESCE(?, language),
                    tone = COALESCE(?, tone),
                    updated_at = ?
                WHERE id = ?
                """,
                (text, language, tone, updated_at, draft_id),
            )
            return cursor.rowcount > 0

    def delete_draft(self, draft_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute("DELETE FROM bci_drafts WHERE id = ?", (draft_id,))
            return cursor.rowcount > 0

    # ------------------------------------------------------------- style/settings
    def get_style(self) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT * FROM bci_style WHERE id = 'default'").fetchone()
        if not row:
            return None
        item = dict(row)
        try:
            item["expressions"] = json.loads(item.pop("expressions_json"))
        except json.JSONDecodeError:
            item["expressions"] = []
        return item

    def save_style(
        self,
        language: str,
        formality: str,
        length: str,
        tone: str,
        expressions: list[str],
        updated_at: str,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO bci_style(id, language, formality, length, tone, expressions_json, updated_at)
                VALUES ('default', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    language = excluded.language,
                    formality = excluded.formality,
                    length = excluded.length,
                    tone = excluded.tone,
                    expressions_json = excluded.expressions_json,
                    updated_at = excluded.updated_at
                """,
                (language, formality, length, tone, json.dumps(expressions, ensure_ascii=False), updated_at),
            )

    def get_setting(self, key: str) -> str | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT value FROM bci_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO bci_settings(key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    # --------------------------------------------------------- confirmations
    def is_provider_confirmed(self, provider: str) -> bool:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT 1 FROM bci_provider_confirmations WHERE provider = ?", (provider,)
            ).fetchone()
        return row is not None

    def confirm_provider(self, provider: str, confirmed_at: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO bci_provider_confirmations(provider, confirmed_at) VALUES (?, ?)
                ON CONFLICT(provider) DO UPDATE SET confirmed_at = excluded.confirmed_at
                """,
                (provider, confirmed_at),
            )
