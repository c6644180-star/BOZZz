from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.conversations.store import ConversationNotFound, ConversationStore
from app.db.database import Database
from app.db.store import IntentStore
from app.identities.service import IdentityService


class ConversationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp.name) / "bozz.sqlite3"
        self.database = Database(self.database_path)
        self.database.initialize()
        self.identities = IdentityService(IntentStore(self.database))
        self.first = self.identities.create_identity(owner_id="owner-a", name="Personal")
        self.second = self.identities.create_identity(owner_id="owner-a", name="Research")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_conversation_and_messages_survive_database_reopen(self) -> None:
        store = ConversationStore(self.database, "owner-a", self.first.id)
        created = store.create()
        store.append_exchange(created["id"], "Remember this project", "I will keep this in this conversation.")
        reopened = ConversationStore(Database(self.database_path), "owner-a", self.first.id)

        restored = reopened.get(created["id"])
        self.assertEqual(restored["title"], "Remember this project")
        self.assertEqual([item["role"] for item in restored["messages"]], ["user", "assistant"])
        self.assertEqual(restored["messages"][0]["content"], "Remember this project")
        self.assertEqual(reopened.recent_history(created["id"]), [
            {"role": "user", "content": "Remember this project"},
            {"role": "assistant", "content": "I will keep this in this conversation."},
        ])

    def test_owner_and_identity_isolation(self) -> None:
        first_store = ConversationStore(self.database, "owner-a", self.first.id)
        conversation = first_store.create("Private chat")
        first_store.append_exchange(conversation["id"], "private", "answer")

        other_identity = ConversationStore(self.database, "owner-a", self.second.id)
        other_owner = ConversationStore(self.database, "owner-b", self.first.id)
        self.assertEqual(other_identity.list(), [])
        self.assertEqual(other_owner.list(), [])
        with self.assertRaises(ConversationNotFound):
            other_identity.get(conversation["id"])
        with self.assertRaises(ConversationNotFound):
            other_owner.delete(conversation["id"])
        self.assertEqual(first_store.get(conversation["id"])["messages"][0]["content"], "private")

    def test_rename_export_and_delete_cascade(self) -> None:
        store = ConversationStore(self.database, "owner-a", self.first.id)
        conversation = store.create("Initial")
        store.append_exchange(conversation["id"], "hello", "hi")
        renamed = store.rename(conversation["id"], "Updated title")
        self.assertEqual(renamed["title"], "Updated title")

        exported = store.export(conversation["id"])
        self.assertEqual(exported["format"], "bozz-conversation-v1")
        self.assertEqual(len(exported["conversation"]["messages"]), 2)

        store.delete(conversation["id"])
        self.assertEqual(store.list(), [])
        with self.assertRaises(ConversationNotFound):
            store.get(conversation["id"])
        with self.database.read() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = ?",
                (conversation["id"],),
            ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_message_size_and_empty_content_are_rejected(self) -> None:
        store = ConversationStore(self.database, "owner-a", self.first.id)
        conversation = store.create()
        with self.assertRaises(ValueError):
            store.append_exchange(conversation["id"], " ", "reply")
        with self.assertRaises(ValueError):
            store.append_exchange(conversation["id"], "x" * 12_001, "reply")


if __name__ == "__main__":
    unittest.main()
