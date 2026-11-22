from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import tempfile
import unittest
from pathlib import Path

from app.agent.service import AgentIdempotencyConflict, AgentService
from app.core.config import Settings
from app.db.database import Database

DEMO_TASK = "open the test site, search for A2D, find the newest video, open it, and prepare a comment 'Hurray!'"
IDEMPOTENCY_KEY = "test-task-key-0000000001"


class AgentIdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.data_dir = Path(self.temp.name)
        self.settings = Settings(data_dir=self.data_dir)
        self.database_path = self.data_dir / "bozz-agent-test.db"
        self.database = Database(self.database_path)
        self.database.initialize()
        self.service = AgentService(self.settings, database=self.database)
        self.service.update_settings({"enabled": True, "dry_run": True}, confirm=True)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_repeated_submission_with_same_key_returns_same_task(self) -> None:
        first = self.service.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)
        second = self.service.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["state"], "awaiting_plan_approval")
        self.assertEqual(second["state"], "awaiting_plan_approval")
        self.assertEqual(len(self.service.tasks()), 1)

    def test_concurrent_duplicate_submissions_reserve_only_one_task(self) -> None:
        def submit() -> dict:
            return self.service.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: submit(), range(4)))

        self.assertEqual(len({item["id"] for item in results}), 1)
        self.assertEqual(len(self.service.tasks()), 1)

    def test_reusing_key_for_different_payload_is_rejected(self) -> None:
        self.service.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)
        with self.assertRaises(AgentIdempotencyConflict):
            self.service.create_task("open a different site", idempotency_key=IDEMPOTENCY_KEY)

    def test_restart_marks_in_flight_task_interrupted_and_never_replays_it(self) -> None:
        created = self.service.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)
        task_id = created["id"]
        with self.database.transaction() as connection:
            connection.execute("UPDATE agent_tasks SET state = 'running' WHERE id = ?", (task_id,))
            connection.execute(
                """
                UPDATE agent_steps
                SET status = 'running', level = 'attempted', detail = 'Adapter call started'
                WHERE task_id = ? AND step_id = ?
                """,
                (task_id, created["plan"]["steps"][0]["id"]),
            )

        restarted = AgentService(self.settings, database=Database(self.database_path))
        recovered = restarted.task(task_id)

        self.assertEqual(recovered["state"], "failed")
        self.assertEqual(recovered["report"]["status"], "Interrupted")
        self.assertIn("not resumed or retried", recovered["report"]["summary"])
        self.assertEqual(recovered["steps"][0]["status"], "interrupted")
        self.assertEqual(recovered["steps"][0]["level"], "unknown")

        # A retry with the same key returns the interrupted record even though
        # the agent is off after restart. It cannot start another external task.
        duplicate = restarted.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)
        self.assertEqual(duplicate["id"], task_id)
        self.assertEqual(duplicate["state"], "failed")
        self.assertEqual(len(restarted.tasks()), 1)

    def test_idempotency_conflict_is_still_enforced_after_restart(self) -> None:
        created = self.service.create_task(DEMO_TASK, idempotency_key=IDEMPOTENCY_KEY)
        with self.database.transaction() as connection:
            connection.execute("UPDATE agent_tasks SET state = 'running' WHERE id = ?", (created["id"],))
        restarted = AgentService(self.settings, database=Database(self.database_path))
        with self.assertRaises(AgentIdempotencyConflict):
            restarted.create_task("different request", idempotency_key=IDEMPOTENCY_KEY)


if __name__ == "__main__":
    unittest.main()
