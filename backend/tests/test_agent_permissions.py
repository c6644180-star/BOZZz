from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from app.agent.schemas import AgentAction, PlanStep
from app.agent.service import AgentError, AgentService
from app.agent.simulated import SimulatedAdapter
from app.core.config import Settings
from app.db.database import Database


class CountingSimulatedAdapter(SimulatedAdapter):
    def __init__(self) -> None:
        super().__init__(start_url="http://127.0.0.1:8000/agent/test-site")
        self.action_calls = 0

    def act(self, action: AgentAction):
        self.action_calls += 1
        return super().act(action)


class AgentPermissionScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.data_dir = Path(self.temp.name)
        self.database = Database(self.data_dir / "bozz-permissions.db")
        self.database.initialize()
        self.service = AgentService(Settings(data_dir=self.data_dir), database=self.database)
        self.service.update_settings({"enabled": True, "dry_run": True}, confirm=True)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_file_scope_is_off_by_default_and_requires_confirmation(self) -> None:
        self.assertFalse(self.service.settings_view()["file_access_enabled"])
        with self.assertRaises(AgentError):
            self.service.update_settings({"file_access_enabled": True}, confirm=False)

        updated = self.service.update_settings({"file_access_enabled": True}, confirm=True)
        self.assertTrue(updated["file_access_enabled"])
        disabled = self.service.update_settings({"file_access_enabled": False})
        self.assertFalse(disabled["file_access_enabled"])

    def test_app_and_device_scopes_cannot_be_enabled_without_adapters(self) -> None:
        with self.assertRaises(AgentError):
            self.service.update_settings({"app_control_enabled": True}, confirm=True)
        with self.assertRaises(AgentError):
            self.service.update_settings({"device_control_enabled": True}, confirm=True)

        status = self.service.status()
        self.assertFalse(status["adapters"]["apps"]["available"])
        self.assertFalse(status["adapters"]["devices"]["available"])

    def test_action_types_map_to_distinct_permission_scopes(self) -> None:
        required = self.service._required_permission_scope
        self.assertEqual(required("browser.download"), "file_access_enabled")
        self.assertEqual(required("browser.upload"), "file_access_enabled")
        self.assertEqual(required("file.delete"), "file_access_enabled")
        self.assertEqual(required("app.launch"), "app_control_enabled")
        self.assertEqual(required("device.ir.send"), "device_control_enabled")
        self.assertIsNone(required("browser.read_text"))

    def test_browser_download_is_blocked_before_adapter_action_when_scope_is_off(self) -> None:
        created = self.service.create_task("inspect the local test page")
        record = self.service._tasks[created["id"]]
        step = PlanStep(
            id="download-step",
            goal="Download the requested file",
            application="Browser",
            method="browser_dom",
            tier=2,
            action=AgentAction("browser.download", {"name": "report.txt"}),
            expected_result="The file is downloaded",
        )
        record.steps = [self.service._step_record(step)]
        adapter = CountingSimulatedAdapter()
        adapter.start()

        result = self.service._execute_step(record, adapter, 0, step, time.monotonic())

        self.assertFalse(result)
        self.assertEqual(adapter.action_calls, 0)
        self.assertEqual(record.steps[0]["status"], "blocked")
        self.assertIn("File access permission is off", record.steps[0]["detail"])
        self.assertEqual(record.report["status"], "Blocked")
        adapter.close()


if __name__ == "__main__":
    unittest.main()
