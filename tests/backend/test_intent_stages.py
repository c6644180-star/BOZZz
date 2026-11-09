import logging
import tempfile
import unittest
from pathlib import Path

from app.db.database import Database
from app.db.store import IntentStore
from app.intent.engine import IntentEngine
from app.intent.stages import can_mark_reported, has_verification_evidence, report_block_reason
from app.tools.workspace import WorkspaceTools


def passing_steps():
    return [
        {"step": "UNDERSTAND", "status": "done", "detail": "understood"},
        {"step": "PLAN", "status": "done", "detail": "planned"},
        {"step": "APPROVE", "status": "done", "detail": "approved"},
        {"step": "EXECUTE", "status": "done", "detail": "ran"},
        {"step": "VERIFY", "status": "done", "detail": "checked"},
        {"step": "REPORT", "status": "pending", "detail": "pending"},
    ]


class StageRuleTests(unittest.TestCase):
    def test_command_is_not_evidence(self):
        report = {
            "verification": [
                {"action": 1, "ok": True, "detail": "Command was issued.", "source": "command"}
            ]
        }
        self.assertFalse(has_verification_evidence(report))
        self.assertIsNotNone(report_block_reason(passing_steps(), report))

    def test_empty_or_failed_evidence_blocks_done(self):
        self.assertFalse(has_verification_evidence(None))
        self.assertFalse(has_verification_evidence({"verification": []}))
        self.assertFalse(
            has_verification_evidence(
                {"verification": [{"action": 1, "ok": False, "detail": "hash mismatch", "source": "filesystem"}]}
            )
        )
        self.assertFalse(
            has_verification_evidence(
                {"verification": [{"action": 1, "ok": True, "detail": "", "source": "filesystem"}]}
            )
        )

    def test_verify_stage_must_be_done(self):
        steps = passing_steps()
        steps[4]["status"] = "running"
        report = {
            "verification": [
                {"action": 1, "ok": True, "detail": "File exists.", "source": "filesystem"}
            ]
        }
        self.assertFalse(can_mark_reported(steps, report))
        self.assertIn("VERIFY has not completed", report_block_reason(steps, report))

    def test_real_filesystem_evidence_allows_done(self):
        report = {
            "verification": [
                {"action": 1, "ok": True, "detail": "File exists with the expected hash.", "source": "filesystem"}
            ]
        }
        self.assertTrue(can_mark_reported(passing_steps(), report))

    def test_local_rule_evidence_allows_done(self):
        report = {
            "verification": [
                {
                    "action": 1,
                    "ok": True,
                    "detail": "Local rules evaluated 4 stored messages; no text was sent to a provider.",
                    "source": "local_rules",
                }
            ]
        }
        self.assertTrue(can_mark_reported(passing_steps(), report))


class EngineEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.store = IntentStore(Database(base / "bozz.sqlite3"))
        self.tools = WorkspaceTools(base / "workspace")
        self.engine = IntentEngine(
            self.store, self.tools, logger=logging.getLogger("test.stages")
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_view_exposes_task_fields_and_approval_state(self):
        run = self.engine.propose("create file stage.txt with content ok")
        self.assertEqual(run["module"], "intent-map")
        self.assertEqual(run["required_permissions"], ["file_access"])
        self.assertEqual(run["approval_state"], "pending")
        self.assertFalse(run["done_allowed"])
        self.assertEqual(run["task"]["stages"], run["steps"])

        approved = self.engine.approve(run["id"], run["approval_id"], True)
        self.assertEqual(approved["approval_state"], "approved")
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "reported")
        self.assertTrue(finished["done_allowed"])
        self.assertEqual(finished["verification_evidence"][0]["source"], "filesystem")

    def test_engine_refuses_to_report_done_without_evidence_detail(self):
        run = self.engine.propose("create file unverified.txt with content x")
        self.engine.approve(run["id"], run["approval_id"], True)
        self.tools.verify = lambda action, result: (True, "")  # type: ignore[method-assign]
        finished = self.engine.execute(run["id"])
        self.assertEqual(finished["status"], "failed")
        self.assertFalse(finished["done_allowed"])
        self.assertFalse(finished["report"]["done_allowed"])
        self.assertIn("not marked done", finished["report"]["summary"])

    def test_unknown_module_is_rejected(self):
        with self.assertRaises(ValueError):
            self.engine.propose("list files", module="unknown")


if __name__ == "__main__":
    unittest.main()
