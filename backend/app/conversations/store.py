"""SQLite store for identity-scoped chat conversations and messages."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3
import uuid
from typing import Any

from app.db.database import Database

MAX_TITLE = 120
MAX_MESSAGE_CHARS = 12_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class ConversationNotFound(LookupError):
    """The conversation is absent or belongs to another owner/identity."""


class ConversationStore:
    """All operations are constrained by both local owner and active identity."""

    def __init__(self, database: Database, owner_id: str, identity_id: str):
        self.database = database
        self.owner_id = owner_id
        self.identity_id = identity_id
        self.database.initialize()
        with self.database.transaction() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    identity_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_conversations_scope_updated
                    ON conversations(owner_id, identity_id, updated_at DESC, id DESC);
                CREATE TABLE IF NOT EXISTS conversation_messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    owner_id TEXT NOT NULL,
                    identity_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_conversation_messages_order
                    ON conversation_messages(conversation_id, created_at, id);
            """)

    @staticmethod
    def _id() -> str:
        return uuid.uuid4().hex

    def _require(self, connection: sqlite3.Connection, conversation_id: str) -> sqlite3.Row:
        row = connection.execute(
            """SELECT * FROM conversations
               WHERE id = ? AND owner_id = ? AND identity_id = ?""",
            (conversation_id, self.owner_id, self.identity_id),
        ).fetchone()
        if row is None:
            raise ConversationNotFound("Conversation was not found in the active identity.")
        return row

    def create(self, title: str = "New conversation") -> dict[str, Any]:
        clean_title = " ".join(title.split())[:MAX_TITLE] or "New conversation"
        now = _now()
        conversation_id = self._id()
        with self.database.transaction() as connection:
            connection.execute(
                """INSERT INTO conversations(id, owner_id, identity_id, title, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (conversation_id, self.owner_id, self.identity_id, clean_title, now, now),
            )
        return {"id": conversation_id, "title": clean_title, "created_at": now, "updated_at": now}

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        bounded = max(1, min(int(limit), 200))
        with self.database.read() as connection:
            rows = connection.execute(
                """SELECT c.id, c.title, c.created_at, c.updated_at,
                          COUNT(m.id) AS messages_count,
                          MAX(m.created_at) AS last_message_at
                   FROM conversations c
                   LEFT JOIN conversation_messages m ON m.conversation_id = c.id
                   WHERE c.owner_id = ? AND c.identity_id = ?
                   GROUP BY c.id
                   ORDER BY c.updated_at DESC, c.id DESC LIMIT ?""",
                (self.owner_id, self.identity_id, bounded),
            ).fetchall()
        return [dict(row) for row in rows]

    def get(self, conversation_id: str) -> dict[str, Any]:
        with self.database.read() as connection:
            row = self._require(connection, conversation_id)
            messages = connection.execute(
                """SELECT id, role, content, created_at FROM conversation_messages
                   WHERE conversation_id = ? AND owner_id = ? AND identity_id = ?
                   ORDER BY rowid ASC""",
                (conversation_id, self.owner_id, self.identity_id),
            ).fetchall()
        return {"id": row["id"], "title": row["title"], "created_at": row["created_at"],
                "updated_at": row["updated_at"], "messages": [dict(item) for item in messages]}

    def recent_history(self, conversation_id: str, limit: int = 12) -> list[dict[str, str]]:
        with self.database.read() as connection:
            self._require(connection, conversation_id)
            rows = connection.execute(
                """SELECT role, content FROM conversation_messages
                   WHERE conversation_id = ? AND owner_id = ? AND identity_id = ?
                   ORDER BY rowid DESC LIMIT ?""",
                (conversation_id, self.owner_id, self.identity_id, max(1, min(limit, 24))),
            ).fetchall()
        return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]

    def append_exchange(self, conversation_id: str, user_text: str, assistant_text: str) -> None:
        user_text = user_text.strip()
        assistant_text = assistant_text.strip()
        if not user_text or not assistant_text:
            raise ValueError("Conversation messages cannot be empty.")
        if len(user_text) > MAX_MESSAGE_CHARS or len(assistant_text) > MAX_MESSAGE_CHARS:
            raise ValueError("Conversation message exceeds the 12,000 character limit.")
        now = _now()
        with self.database.transaction() as connection:
            conversation = self._require(connection, conversation_id)
            if conversation["title"] == "New conversation":
                title = " ".join(user_text.split())[:MAX_TITLE]
                connection.execute(
                    "UPDATE conversations SET title = ? WHERE id = ?", (title or "New conversation", conversation_id)
                )
            connection.executemany(
                """INSERT INTO conversation_messages
                   (id, conversation_id, owner_id, identity_id, role, content, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [
                    (self._id(), conversation_id, self.owner_id, self.identity_id, "user", user_text, now),
                    (self._id(), conversation_id, self.owner_id, self.identity_id, "assistant", assistant_text, now),
                ],
            )
            connection.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conversation_id)
            )

    def rename(self, conversation_id: str, title: str) -> dict[str, Any]:
        clean_title = " ".join(title.split())[:MAX_TITLE]
        if not clean_title:
            raise ValueError("Conversation title cannot be empty.")
        now = _now()
        with self.database.transaction() as connection:
            self._require(connection, conversation_id)
            connection.execute(
                """UPDATE conversations SET title = ?, updated_at = ?
                   WHERE id = ? AND owner_id = ? AND identity_id = ?""",
                (clean_title, now, conversation_id, self.owner_id, self.identity_id),
            )
        return self.get(conversation_id)

    def delete(self, conversation_id: str) -> None:
        with self.database.transaction() as connection:
            self._require(connection, conversation_id)
            connection.execute(
                "DELETE FROM conversations WHERE id = ? AND owner_id = ? AND identity_id = ?",
                (conversation_id, self.owner_id, self.identity_id),
            )

    def export(self, conversation_id: str) -> dict[str, Any]:
        conversation = self.get(conversation_id)
        return {"format": "bozz-conversation-v1", "exported_at": _now(), "conversation": conversation}
