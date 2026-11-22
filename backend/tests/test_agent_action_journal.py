from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.agent.store import AgentStore
from app.db.database import Database


class AgentActionJournalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.temp.name)
        self.database = Database(self.root / "agent-journal.db")
        self.database.initialize()
        self.store = AgentStore(self.database)
        self.task_id = "journal-task-1"
        self.now = "2026-11-22T12:00:00+00:00"
        self.store.reserve_task(
            idempotency_key="journal-idempotency-key-1",
            request_hash="request-hash-1",
            task_id=self.task_id,
            task="Open the BOZZ test page",
            dry_run=False,
            provider="test",
            model="test-model",
            created_at=self.now,
        )
        self.store.save_task({
            "id": self.task_id,
            "task": "Open the BOZZ test page",
            "state": "running",
            "dry_run": False,
            "plan": {
                "steps": [{
                    "id": "step-1",
                    "goal": "Open the test page",
                    "application": "Browser",
                    "method": "browser_dom",
                    "tier": 1,
                    "action": {"type": "browser.open", "params": {"url": "http://127.0.0.1:8000/agent/test-site"}},
                    "expected_result": "The test page is open",
                    "dependencies": [],
                    "verify": None,
                }]
            },
            "steps": [{
                "id": "step-1",
                "status": "running",
                "level": "attempted",
                "detail": "Adapter action is in progress",
            }],
            "created_at": self.now,
            "updated_at": self.now,
        })

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_action_is_durably_started_then_finished_with_result(self) -> None:
        journal_id = self.store.begin_action(
            task_id=self.task_id,
            step_id="step-1",
            attempt=1,
            action_type="browser.open",
            action_fingerprint="fingerprint-1",
            started_at=self.now,
        )
        started = self.store.list_action_journal(self.task_id)
        self.assertEqual(len(started), 1)
        self.assertEqual(started[0]["state"], "started")
        self.assertIsNone(started[0]["result"])

        self.store.finish_action(
            journal_id,
            state="completed",
            result={"ok": True, "level": "completed", "detail": "Page opened"},
            finished_at=self.now,
        )
        finished = self.store.list_action_journal(self.task_id)[0]
        self.assertEqual(finished["state"], "completed")
        self.assertEqual(finished["result"]["detail"], "Page opened")
        self.assertEqual(finished["finished_at"], self.now)

    def test_restart_marks_started_action_unknown_and_prevents_replay(self) -> None:
        self.store.begin_action(
            task_id=self.task_id,
            step_id="step-1",
            attempt=1,
            action_type="browser.open",
            action_fingerprint="fingerprint-1",
            started_at=self.now,
        )

        recovered_count = self.store.recover_interrupted_tasks("2026-11-22T12:01:00+00:00")

        self.assertEqual(recovered_count, 1)
        journal = self.store.list_action_journal(self.task_id)[0]
        self.assertEqual(journal["state"], "unknown")
        self.assertIn("did not replay", journal["result"]["detail"])
        with self.assertRaisesRegex(RuntimeError, "already recorded as unknown"):
            self.store.begin_action(
                task_id=self.task_id,
                step_id="step-1",
                attempt=1,
                action_type="browser.open",
                action_fingerprint="fingerprint-1",
                started_at="2026-11-22T12:02:00+00:00",
            )

    def test_completed_action_cannot_be_finished_twice(self) -> None:
        journal_id = self.store.begin_action(
            task_id=self.task_id,
            step_id="step-1",
            attempt=1,
            action_type="browser.open",
            action_fingerprint="fingerprint-1",
            started_at=self.now,
        )
        self.store.finish_action(
            journal_id,
            state="completed",
            result={"ok": True},
            finished_at=self.now,
        )
        with self.assertRaisesRegex(RuntimeError, "not in a writable started state"):
            self.store.finish_action(
                journal_id,
                state="failed",
                result={"ok": False},
                finished_at="2026-11-22T12:02:00+00:00",
            )


if __name__ == "__main__":
    unittest.main()
