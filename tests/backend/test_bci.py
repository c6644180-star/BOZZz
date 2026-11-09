import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app.ai.base import LocalProviderError, ProviderStatus
from app.bci.parsers import BciImportError, parse_import, parse_import_full
from app.bci.service import (
    MAX_CHARS,
    MAX_MESSAGES,
    BciService,
    BciValidationError,
    ProviderConfirmationRequired,
    apply_confirm_guard,
    extract_placeholders,
)
from app.bci.store import BciStore
from app.db.database import Database
from app.db.store import IntentStore
from app.main import app
from app.modules import PermissionManager


class FakeProvider:
    def __init__(
        self,
        reply: str = "A local reply.",
        *,
        name: str = "ollama",
        available: bool = True,
        local: bool = True,
    ):
        self.provider_name = name
        self.configured_model = "fake-model"
        self.is_local = local
        self.reply = reply
        self.available = available
        self.calls: list[str] = []

    def status(self) -> ProviderStatus:
        return ProviderStatus(
            available=self.available,
            provider=self.provider_name,
            configured_model=self.configured_model,
            models=[self.configured_model] if self.available else [],
            detail=None if self.available else "The fake provider is unavailable.",
        )

    def chat(self, message: str, history: list[dict[str, str]]) -> str:
        self.calls.append(message)
        if not self.available:
            raise LocalProviderError("The fake provider is unavailable.")
        return self.reply


WHATSAPP_EXPORT = """Messages and calls are end-to-end encrypted.
[09/11/2025, 10:30:00] Alice: Can you send the quote?
[09/11/2025, 10:31:15] Me: I will check today.
this line continues the previous message
[09/11/2025, 10:35:00] Alice: What is the deadline?
"""

SPEAKER_TEXT = """Alice: Hello there
Me: Hi Alice
Alice: Can we meet tomorrow?
"""

JSON_EXPORT = """
{
  "messages": [
    {"sender": "Me", "text": "Hi, I checked the invoice.", "timestamp": 1762693800},
    {"from": "Alice", "body": "Great. What is the total?"}
  ]
}
"""


class ImportParserTests(unittest.TestCase):
    def test_whatsapp_export_parses_dates_directions_and_multiline(self):
        preview = parse_import("chat.txt", WHATSAPP_EXPORT)
        self.assertEqual(preview["format"], "whatsapp")
        self.assertEqual(preview["message_count"], 3)
        self.assertEqual(preview["outbound_count"], 1)
        first = preview["messages"][0]
        self.assertEqual(first["sender"], "Alice")
        self.assertEqual(first["direction"], "inbound")
        self.assertTrue(first["sent_at"].startswith("2025-11-09T10:30"))
        self.assertIn("continues the previous message", preview["messages"][1]["text"])

    def test_json_export_accepts_aliases_and_epoch_timestamps(self):
        preview = parse_import("chat.json", JSON_EXPORT)
        self.assertEqual(preview["format"], "json")
        self.assertEqual(preview["message_count"], 2)
        self.assertEqual(preview["messages"][0]["direction"], "outbound")
        self.assertTrue(preview["messages"][0]["sent_at"].startswith("2025-11-09"))

    def test_plain_text_and_single_blob_are_accepted(self):
        speaker = parse_import("notes.txt", SPEAKER_TEXT)
        self.assertEqual(speaker["format"], "text")
        self.assertEqual(speaker["message_count"], 3)
        self.assertEqual(speaker["messages"][1]["direction"], "outbound")

        blob = parse_import("notes.txt", "just a note without speakers")
        self.assertEqual(blob["message_count"], 1)
        self.assertEqual(blob["messages"][0]["sender"], "Imported text")
        self.assertTrue(blob["warnings"])

    def test_preview_caps_at_fifty_but_full_parse_keeps_everything(self):
        lines = [f"Alice: message {index}" for index in range(75)]
        preview = parse_import("many.txt", "\n".join(lines))
        self.assertEqual(preview["message_count"], 75)
        self.assertEqual(len(preview["messages"]), 50)
        self.assertTrue(preview["truncated"])
        self.assertEqual(len(parse_import_full("many.txt", "\n".join(lines))), 75)

    def test_unsupported_and_empty_files_are_rejected(self):
        with self.assertRaises(BciImportError):
            parse_import("chat.pdf", "nope")
        with self.assertRaises(BciImportError):
            parse_import("chat.txt", "   ")


class BciServiceTests(unittest.TestCase):
    NOW = "2026-11-09T12:00:00+00:00"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.database = Database(Path(os.path.realpath(self._tmp.name)) / "bci.sqlite3")
        self.audit = IntentStore(self.database)
        self.store = BciStore(self.database)
        self.provider = FakeProvider()
        self.service = BciService(self.store, self.audit, self.provider, clock=lambda: self.NOW)
        self.permissions = PermissionManager(self.audit, clock=lambda: self.NOW)

    def tearDown(self):
        self._tmp.cleanup()

    def _conversation(self, *, title="Chat", retention=None):
        conversation = self.service.create_conversation(
            title=title,
            source="text",
            messages=[
                {"sender": "Alice", "text": "Can you send the quote?", "direction": "inbound"},
                {"sender": "Me", "text": "I will check.", "direction": "outbound"},
                {"sender": "Alice", "text": "What is the deadline?", "direction": "inbound"},
            ],
        )
        if retention is not None:
            conversation = self.service.update_conversation(
                conversation["id"], title=None, retention_days=retention
            )
        return conversation

    def test_message_data_permission_is_off_by_default(self):
        self.assertEqual(self.permissions.missing("bci", ["message_data"]), ["message_data"])
        self.permissions.set_permission("bci", "message_data", True)
        self.assertEqual(self.permissions.missing("bci", ["message_data"]), [])
        events = {row["event"] for row in self.audit.list_audit(50)}
        self.assertIn("permission_grant", events)

    def test_limits_reject_too_many_messages_and_characters(self):
        too_many = [
            {"sender": "Me", "text": "x", "direction": "outbound"}
            for _ in range(MAX_MESSAGES + 1)
        ]
        with self.assertRaises(BciValidationError):
            self.service.create_conversation(title="Many", source="manual", messages=too_many)

        allowed = [
            {"sender": "Me", "text": "x", "direction": "outbound"}
            for _ in range(MAX_MESSAGES)
        ]
        created = self.service.create_conversation(title="At limit", source="manual", messages=allowed)
        self.assertEqual(created["messages_count"], MAX_MESSAGES)

        with self.assertRaises(BciValidationError):
            self.service.create_conversation(
                title="Too long",
                source="manual",
                messages=[{"sender": "Me", "text": "x" * (MAX_CHARS + 1)}],
            )

        exact = self.service.create_conversation(
            title="Exact chars",
            source="manual",
            messages=[{"sender": "Me", "text": "x" * MAX_CHARS}],
        )
        self.assertEqual(exact["char_count"], MAX_CHARS)

    def test_retention_cleanup_deletes_expired_conversations_only(self):
        old = (datetime.fromisoformat(self.NOW) - timedelta(days=45)).isoformat(timespec="seconds")
        expired = self.service.create_conversation(
            title="Old chat",
            source="text",
            messages=[{"sender": "Alice", "text": "Old question", "direction": "inbound", "sent_at": old}],
        )
        self.service.update_conversation(expired["id"], title=None, retention_days=30)
        kept = self.service.create_conversation(
            title="Keep forever",
            source="text",
            messages=[{"sender": "Alice", "text": "Keep me", "direction": "inbound", "sent_at": old}],
        )
        self.service.update_conversation(kept["id"], title=None, retention_days=0)
        recent = self._conversation(title="Recent")

        result = self.service.cleanup_expired()
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["ids"], [expired["id"]])
        self.assertIsNotNone(self.store.get_conversation(kept["id"]))
        self.assertIsNotNone(self.store.get_conversation(recent["id"]))
        self.assertIn("bci_retention_cleanup", {row["event"] for row in self.audit.list_audit(20)})

    def test_no_send_path_exists(self):
        method_names = [name for name in dir(BciService) if "send" in name.casefold()]
        self.assertEqual(method_names, [])
        for route in app.routes:
            path = getattr(route, "path", "")
            self.assertNotIn("send", path.casefold(), path)
            self.assertNotIn("smtp", path.casefold(), path)

    def test_remote_provider_requires_explicit_one_time_confirmation(self):
        remote = FakeProvider(name="cloud-demo", local=False)
        service = BciService(self.store, self.audit, remote, clock=lambda: self.NOW)
        conversation = self._conversation()
        info = service.provider_info()
        self.assertTrue(info["requires_confirmation"])

        with self.assertRaises(ProviderConfirmationRequired):
            service.run_action(conversation["id"], "summarise", {})
        with self.assertRaises(BciValidationError):
            service.confirm_provider("cloud-demo", False)

        confirmed = service.confirm_provider("cloud-demo", True)
        self.assertFalse(confirmed["requires_confirmation"])
        events = [row["event"] for row in self.audit.list_audit(10)]
        self.assertIn("provider_confirm", events)

        result = service.run_action(conversation["id"], "summarise", {})
        self.assertEqual(result["status"], "reported")
        self.assertTrue(remote.calls)

    def test_draft_action_stores_a_local_draft_with_confirm_placeholders(self):
        self.provider.reply = (
            "Thanks Alice, the total is $250 and we can deliver at 10:30. "
            "[CONFIRM: confirm the delivery date]"
        )
        conversation = self._conversation()
        result = self.service.run_action(conversation["id"], "draft", {})
        self.assertEqual(result["status"], "reported")
        self.assertTrue(result["done_allowed"])
        self.assertEqual(result["verification_evidence"][0]["source"], "model_response")
        self.assertIn("no send path", result["verification_evidence"][0]["detail"].casefold())
        self.assertIn("No message was sent.", result["message"])
        draft = result["result"]["draft"]
        self.assertTrue(draft["not_sent"])
        self.assertIn("[CONFIRM:", draft["text"])
        self.assertNotIn("total is $250", draft["text"])
        self.assertNotIn("deliver at 10:30", draft["text"])
        self.assertEqual(draft["placeholders"], extract_placeholders(draft["text"]))
        self.assertTrue(draft["placeholders"])

        stored = self.service.get_conversation(conversation["id"])
        self.assertEqual(len(stored["drafts"]), 1)
        self.assertEqual(stored["drafts"][0]["id"], draft["id"])

        prompt = self.provider.calls[-1]
        self.assertIn("Never invent facts", prompt)
        self.assertIn("Can you send the quote?", prompt)
        events = {row["event"] for row in self.audit.list_audit(20)}
        self.assertIn("bci_action", events)
        self.assertIn("bci_draft", events)

    def test_attention_and_unanswered_use_local_rules(self):
        conversation = self._conversation()
        detail = self.service.get_conversation(conversation["id"])
        self.assertEqual(detail["unanswered_count"], 1)
        self.assertGreaterEqual(detail["needs_attention"], 2)
        flagged = [message for message in detail["messages"] if message["attention"]]
        self.assertIn("question", flagged[0]["attention"])

        result = self.service.run_action(conversation["id"], "unanswered", {})
        self.assertEqual(result["status"], "reported")
        self.assertEqual(len(result["result"]["questions"]), 1)
        self.assertEqual(result["result"]["questions"][0]["sender"], "Alice")
        self.assertEqual(result["result"]["provider"], "local")
        self.assertEqual(result["verification_evidence"][0]["source"], "local_rules")
        self.assertIn("No text was sent to any provider", result["verification_evidence"][0]["detail"])
        self.assertIn("What is the deadline?", result["result"]["text"])

        briefing = self.service.run_action(conversation["id"], "attention", {})
        self.assertEqual(briefing["status"], "reported")
        self.assertTrue(briefing["result"]["items"])
        self.assertEqual(briefing["result"]["provider"], "local")
        self.assertEqual(briefing["verification_evidence"][0]["source"], "local_rules")
        self.assertIn("Can you send the quote?", briefing["result"]["text"])
        self.assertEqual(self.provider.calls, [])

    def test_prompt_include_confirmation_rule_and_style(self):
        self.service.save_style(
            {"language": "English", "formality": "casual", "length": "short", "tone": "warm", "expressions": ["Hi"]}
        )
        conversation = self._conversation()
        self.service.run_action(conversation["id"], "summarise", {})
        prompt = self.provider.calls[-1]
        self.assertIn("[CONFIRM: short question]", prompt)
        self.assertIn("no send path", prompt.casefold())
        self.assertIn("Summarise the conversation", prompt)

    def test_unavailable_provider_creates_a_failed_task_without_evidence(self):
        self.provider.available = False
        conversation = self._conversation()
        result = self.service.run_action(conversation["id"], "summarise", {})
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["done_allowed"])
        self.assertEqual(result["verification_evidence"], [])
        self.assertIn("Nothing was sent.", result["message"])
        self.assertIsNone(result["result"])

    def test_delete_all_requires_explicit_confirmation(self):
        self._conversation()
        with self.assertRaises(BciValidationError):
            self.service.delete_all(False)
        result = self.service.delete_all(True)
        self.assertEqual(result["count"], 1)
        self.assertEqual(self.service.list_conversations(), [])
        events = {row["event"] for row in self.audit.list_audit(20)}
        self.assertIn("bci_delete_all", events)

    def test_import_stores_full_conversation_and_preview_is_capped(self):
        conversation = self.service.import_conversation("chat.txt", WHATSAPP_EXPORT)
        self.assertEqual(conversation["source"], "whatsapp")
        self.assertEqual(conversation["messages_count"], 3)
        self.assertEqual(conversation["char_count"], len("Can you send the quote?") + len(
            "I will check today.\nthis line continues the previous message"
        ) + len("What is the deadline?"))

    def test_list_filters_by_search_source_and_attention(self):
        invoice = self._conversation(title="Invoice chat")
        calm = self.service.create_conversation(
            title="Calm notes",
            source="simulation",
            messages=[{"sender": "Me", "text": "All done.", "direction": "outbound"}],
        )

        by_title = self.service.list_conversations(query="invoice")
        self.assertEqual([row["id"] for row in by_title], [invoice["id"]])

        by_message = self.service.list_conversations(query="deadline")
        self.assertEqual([row["id"] for row in by_message], [invoice["id"]])
        self.assertIn("Alice:", by_message[0]["search_excerpt"])

        simulation_only = self.service.list_conversations(source="simulation")
        self.assertEqual([row["id"] for row in simulation_only], [calm["id"]])

        flagged = self.service.list_conversations(attention_only=True)
        self.assertEqual([row["id"] for row in flagged], [invoice["id"]])
        self.assertGreater(flagged[0]["needs_attention"], 0)

        self.assertEqual(self.service.list_conversations(query="nothing-matches"), [])

    def test_confirm_guard_replaces_invented_money_and_times(self):
        guarded = apply_confirm_guard(
            "It costs $99 tomorrow at 08:15.", "It costs about fifty tomorrow."
        )
        self.assertNotIn("costs $99", guarded)
        self.assertNotIn("at 08:15", guarded)
        self.assertIn('verify "$99"', guarded)
        self.assertEqual(len(extract_placeholders(guarded)), 2)
        unchanged = apply_confirm_guard("The total is $50 at 10:30.", "We agreed $50 at 10:30.")
        self.assertEqual(unchanged, "The total is $50 at 10:30.")


if __name__ == "__main__":
    unittest.main()
