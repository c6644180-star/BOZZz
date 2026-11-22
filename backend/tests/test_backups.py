from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.backups.service import BackupValidationError, DatabaseBackupService
from app.conversations.store import ConversationStore
from app.db.database import Database
from app.db.store import IntentStore
from app.identities.service import IdentityService


class DatabaseBackupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.database_path = root / "bozz.sqlite3"
        self.backup_dir = root / "backups"
        self.database = Database(self.database_path)
        self.database.initialize()
        self.identity_service = IdentityService(IntentStore(self.database))
        self.identity = self.identity_service.create_identity(owner_id="owner-a", name="Personal")
        self.conversations = ConversationStore(self.database, "owner-a", self.identity.id)
        self.conversation = self.conversations.create("Before backup")
        self.conversations.append_exchange(self.conversation["id"], "original question", "original answer")
        self.backups = DatabaseBackupService(self.database, self.backup_dir)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_backup_restore_recovers_database_and_creates_safety_copy(self) -> None:
        backup = self.backups.create_backup()
        self.identity_service.create_identity(owner_id="owner-a", name="Created after backup")
        extra = self.conversations.create("Created after backup")

        result = self.backups.restore(backup["id"])
        self.assertTrue(result["restored"])
        self.assertTrue(result["safety_backup_id"].startswith("safety-"))

        reopened = Database(self.database_path)
        identities = IdentityService(IntentStore(reopened)).list_identities(owner_id="owner-a")
        self.assertEqual([item["name"] for item in identities], ["Personal"])

        restored_conversations = ConversationStore(reopened, "owner-a", self.identity.id)
        self.assertEqual(restored_conversations.get(self.conversation["id"])["messages"][0]["content"], "original question")
        self.assertEqual(restored_conversations.list(), [{
            **restored_conversations.list()[0],
        }])
        self.assertEqual(len(self.backups.list_backups()), 2)
        with self.assertRaises(Exception):
            restored_conversations.get(extra["id"])

    def test_invalid_backup_is_rejected_without_replacing_database(self) -> None:
        backup_id = "a" * 32
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        (self.backup_dir / f"{backup_id}.sqlite3").write_bytes(b"not a sqlite database")
        with self.assertRaises((BackupValidationError, sqlite3.DatabaseError)):
            self.backups.restore(backup_id)

        identities = IdentityService(IntentStore(Database(self.database_path))).list_identities(owner_id="owner-a")
        self.assertEqual([item["name"] for item in identities], ["Personal"])

    def test_backup_ids_cannot_escape_backup_directory(self) -> None:
        with self.assertRaises(ValueError):
            self.backups.restore("../../outside")


if __name__ == "__main__":
    unittest.main()
