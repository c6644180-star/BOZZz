import logging
import tempfile
import unittest
from pathlib import Path

from app.db.database import Database
from app.db.store import IntentStore
from app.intent.engine import ApprovalError, IntentEngine, InvalidStateError
from app.tools.workspace import WorkspaceTools


class IntentWorkflowTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        base = Path(self._temp.name)
        self.workspace = base / "workspace"
        self.store = IntentStore(Database(base / "bozz.sqlite3"))
        self.tools = WorkspaceTools(self.workspace)
        self.engine = IntentEngine(self.store, self.tools, logger=logging.getLogger("test.intent"))

    def tearDown(self):
        self._temp.cleanup()

    def _propose_and_approve(self, text):
        run = self.engine.propose(text)
        self.assertEqual(run["status"], "awaiting_approval", run)
        approved = self.engine.approve(run["id"], run["approval_id"], True)
        self.assertEqual(approved["status"], "approved")
        return approved

    def test_write_flow_reaches_report_with_verified_result(self):
        run = self.engine.propose("create file demo/hello.txt with content Hello from BOZZ")
        self.assertEqual(run["status"], "awaiting_approval")
        self.assertEqual([step["step"] for step in run["steps"]], ["UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT"])
        self.assertEqual(run["actions"][0]["risk"], "medium")
        self.assertTrue(run["actions"][0]["reversible"])
        self.assertTrue(run["approval_required"])

        approved = self.engine.approve(run["id"], run["approval_id"], True)
        self.assertEqual(approved["steps"][2]["status"], "done")

        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported", finished)
        self.assertEqual((self.workspace / "demo/hello.txt").read_text(encoding="utf-8"), "Hello from BOZZ")
        self.assertEqual(finished["report"]["verification"][0]["ok"], True)
        self.assertIn("verified", finished["report"]["summary"])
        self.assertEqual([step["status"] for step in finished["steps"]], ["done"] * 6)

    def test_read_and_list_flow(self):
        self.tools.write_file("notes.txt", "local only")
        run = self._propose_and_approve("read notes.txt")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")
        self.assertEqual(finished["report"]["actions"][0]["target"], "notes.txt")

        run = self._propose_and_approve("list files")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")

    def test_approval_requires_matching_challenge_and_confirmation(self):
        run = self.engine.propose("create file a.txt with content x")
        with self.assertRaises(ApprovalError):
            self.engine.approve(run["id"], "not-the-token", True)
        with self.assertRaises(ApprovalError):
            self.engine.approve(run["id"], run["approval_id"], False)
        self.assertEqual(self.engine.get(run["id"])["status"], "awaiting_approval")

    def test_execute_before_approval_is_refused(self):
        run = self.engine.propose("create file a.txt with content x")
        with self.assertRaises(InvalidStateError):
            self.engine.execute(run["id"])
        self.assertFalse((self.workspace / "a.txt").exists())

    def test_reject_never_executes(self):
        self.tools.write_file("notes.txt", "data")
        run = self.engine.propose("delete notes.txt")
        rejected = self.engine.reject(run["id"], "not needed")
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(rejected["report"], None)
        self.assertTrue((self.workspace / "notes.txt").exists())

    def test_unrecognised_text_plans_nothing(self):
        run = self.engine.propose("book me a flight to Tokyo")
        self.assertEqual(run["status"], "unrecognized")
        self.assertEqual(run["actions"], [])
        self.assertTrue(run["examples"])
        with self.assertRaises(InvalidStateError):
            self.engine.approve(run["id"], "x" * 12, True)

    def test_escape_attempts_are_blocked_before_approval(self):
        for text in ("read ../secret.txt", "delete C:/Windows/win.ini", "list files in .."):
            with self.subTest(text=text):
                run = self.engine.propose(text)
                self.assertEqual(run["status"], "blocked", run)
                self.assertEqual(run["actions"], [])

    def test_existing_file_is_blocked_until_overwrite_is_explicit(self):
        self.tools.write_file("notes.txt", "first")
        blocked = self.engine.propose("create file notes.txt with content second")
        self.assertEqual(blocked["status"], "blocked")
        self.assertIn("already exists", blocked["message"])

        run = self._propose_and_approve("overwrite file notes.txt with content second")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")
        self.assertEqual((self.workspace / "notes.txt").read_text(encoding="utf-8"), "second")
        backups = list((self.workspace / ".trash" / "overwrites").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(encoding="utf-8"), "first")

    def test_delete_is_high_risk_and_recoverable(self):
        self.tools.write_file("gone.txt", "data")
        run = self.engine.propose("delete gone.txt")
        self.assertEqual(run["status"], "awaiting_approval")
        self.assertEqual(run["actions"][0]["risk"], "high")
        self.assertTrue(run["actions"][0]["reversible"])
        self.assertEqual(self.engine.approve(run["id"], run["approval_id"], True)["status"], "approved")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")
        self.assertFalse((self.workspace / "gone.txt").exists())
        self.assertEqual(len(list((self.workspace / ".trash").iterdir())), 1)

    def test_audit_log_is_append_only_and_complete(self):
        run = self._propose_and_approve("create file audit.txt with content ok")
        self.engine.execute(run["id"])
        entries = self.engine.audit(100)
        events = [entry["event"] for entry in entries]
        for expected in ("report", "verify", "execute", "approve", "propose"):
            self.assertIn(expected, events)
        self.assertEqual(len(entries), 5)

    def test_move_and_search_flow(self):
        created = self._propose_and_approve("create file report.txt with content quarterly numbers")
        self.assertEqual(self.engine.execute(created["id"])["status"], "reported")
        run = self._propose_and_approve("move report.txt to archive/report.txt")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")
        self.assertTrue((self.workspace / "archive/report.txt").is_file())

        run = self._propose_and_approve("search for quarterly in archive")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")
        self.assertEqual(finished["report"]["actions"][0]["target"], "archive")


if __name__ == "__main__":
    unittest.main()
