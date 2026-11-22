from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.api.chat import ChatRequest, chat
from app.conversations.store import ConversationStore
from app.db.database import Database
from app.db.store import IntentStore
from app.identities.service import IdentityService


class FakeProvider:
    provider_name = "test-provider"
    configured_model = "test-model"

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[dict[str, str]]]] = []

    def chat(self, message: str, history: list[dict[str, str]]) -> str:
        self.calls.append((message, history))
        return f"reply to: {message}"


class FakeRegistry:
    def __init__(self, provider: FakeProvider):
        self.provider = provider

    def default(self) -> FakeProvider:
        return self.provider


class ChatPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.temp.name) / "bozz.sqlite3")
        self.database.initialize()
        identities = IdentityService(IntentStore(self.database))
        self.first = identities.create_identity(owner_id="owner-a", name="Personal")
        self.second = identities.create_identity(owner_id="owner-a", name="Research")
        self.store = ConversationStore(self.database, "owner-a", self.first.id)
        self.provider = FakeProvider()
        self.registry = FakeRegistry(self.provider)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_chat_persists_exchanges_and_uses_server_transcript_as_context(self) -> None:
        with patch("app.api.chat.get_registry", return_value=self.registry), patch(
            "app.api.chat.get_conversation_store", return_value=self.store
        ), patch("app.api.chat._memory_context", return_value=None):
            first = chat(ChatRequest(message="first question"))
            second = chat(ChatRequest(message="follow-up", conversation_id=first.conversation_id))

        self.assertEqual(first.conversation_id, second.conversation_id)
        self.assertEqual(self.provider.calls[0][1], [])
        self.assertEqual(
            self.provider.calls[1][1],
            [
                {"role": "user", "content": "first question"},
                {"role": "assistant", "content": "reply to: first question"},
            ],
        )
        saved = self.store.get(first.conversation_id)
        self.assertEqual(len(saved["messages"]), 4)
        self.assertEqual(saved["messages"][-2]["content"], "follow-up")

    def test_chat_rejects_conversation_from_another_identity(self) -> None:
        other = ConversationStore(self.database, "owner-a", self.second.id)
        private = self.store.create("Private")
        with patch("app.api.chat.get_registry", return_value=self.registry), patch(
            "app.api.chat.get_conversation_store", return_value=other
        ), patch("app.api.chat._memory_context", return_value=None):
            with self.assertRaises(HTTPException) as caught:
                chat(ChatRequest(message="do not cross identities", conversation_id=private["id"]))
        self.assertEqual(caught.exception.status_code, 404)

    def test_non_persistent_internal_chat_does_not_create_a_conversation(self) -> None:
        with patch("app.api.chat.get_registry", return_value=self.registry), patch(
            "app.api.chat.get_conversation_store", side_effect=AssertionError("store should not be opened")
        ), patch("app.api.chat._memory_context", return_value=None):
            response = chat(ChatRequest(message="one-off analysis", persist_conversation=False))
        self.assertIsNone(response.conversation_id)
        self.assertEqual(self.provider.calls[-1][0], "one-off analysis")


if __name__ == "__main__":
    unittest.main()
