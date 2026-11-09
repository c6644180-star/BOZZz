from __future__ import annotations

import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path

from app.agent.adapters.browser import BrowserAdapter
from app.agent.adapters.base import AdapterError
from app.agent.registry import CapabilityRegistry
from app.agent.schemas import AgentAction, AgentPlan, AgentSettings, PlanStep, VerificationCheck
from app.agent.service import AgentDisabled, AgentError, AgentService
from app.agent.simulated import SimulatedAdapter
from app.core.config import Settings

DEMO_TASK = "open the test site, search for A2D, find the newest video, open it, and prepare a comment 'Hurray!'"


class ExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.data_dir = Path(self._temporary.name)
        self.settings = Settings(data_dir=self.data_dir)
        self.registry = CapabilityRegistry(results_dir=self.data_dir / "results")
        self.service = AgentService(
            self.settings,
            provider=None,
            registry=self.registry,
            adapter_factory=lambda record: SimulatedAdapter(),
        )

    def tearDown(self) -> None:
        self._temporary.cleanup()

    def _enable(self, *, approval_mode: str = "tier2", dry_run: bool = False) -> None:
        self.service.update_settings(
            {"enabled": True, "dry_run": dry_run, "approval_mode": approval_mode},
            confirm=True,
        )

    def _run_task(self, *, approve: bool = True, dry_run: bool | None = False) -> dict:
        view = self.service.create_task(DEMO_TASK, dry_run=dry_run)
        self.assertEqual(view["state"], "awaiting_plan_approval")
        self.service.approve_plan(view["id"], confirm=True)
        deadline = time.time() + 8
        while time.time() < deadline:
            view = self.service.task(view["id"])
            if view["state"] in ("done", "failed", "stopped", "cancelled"):
                return view
            pending = view.get("pending_approval")
            if pending and view["state"] == "awaiting_approval":
                self.service.approve_step(view["id"], pending["approval_id"], approve)
            time.sleep(0.01)
        self.fail(f"task did not finish; last state {view['state']}")

    def test_live_demo_reports_done_only_with_verified_evidence(self) -> None:
        self._enable()
        view = self._run_task()
        self.assertEqual(view["state"], "done")
        self.assertEqual(view["report"]["status"], "Done")
        self.assertTrue(all(step["status"] == "verified" for step in view["steps"]))
        self.assertTrue(all(step["level"] == "verified" for step in view["steps"]))
        self.assertEqual(view["steps"][-1]["id"], "draft-comment")
        self.assertIn("This page tried to instruct the agent. Ignored.", view["injection_warnings"])
        self.assertTrue(any(entry["event"] == "agent_injection" for entry in self.service.audit(100)))

    def test_dry_run_executes_nothing(self) -> None:
        self._enable(dry_run=True)
        view = self._run_task(dry_run=None)
        self.assertEqual(view["state"], "done")
        self.assertEqual(view["report"]["status"], "Dry run")
        self.assertTrue(all(step["level"] == "attempted" for step in view["steps"]))
        self.assertFalse(any(entry["event"] == "agent_action" for entry in self.service.audit(100)))
        self.assertTrue(any(entry["event"] == "agent_dry_run" for entry in self.service.audit(100)))

    def test_denied_approval_stops_the_task(self) -> None:
        self._enable()
        view = self._run_task(approve=False)
        self.assertEqual(view["state"], "stopped")
        self.assertEqual(view["report"]["status"], "Stopped")
        self.assertIn("denied", view["report"]["summary"].casefold())

    def test_step_cap_stops_the_task(self) -> None:
        self._enable()
        view = self.service.create_task(DEMO_TASK, dry_run=False)
        record = self.service._tasks[view["id"]]
        record.settings = replace(record.settings, max_steps=1)
        self.service.approve_plan(view["id"], confirm=True)
        deadline = time.time() + 8
        while time.time() < deadline:
            view = self.service.task(view["id"])
            pending = view.get("pending_approval")
            if pending and view["state"] == "awaiting_approval":
                self.service.approve_step(view["id"], pending["approval_id"], True)
            if view["state"] in ("done", "failed", "stopped", "cancelled"):
                break
            time.sleep(0.01)
        self.assertEqual(view["state"], "stopped")
        self.assertIn("Step limit", view["report"]["summary"])

    def test_time_cap_stops_the_task(self) -> None:
        self._enable()
        view = self.service.create_task(DEMO_TASK, dry_run=False)
        record = self.service._tasks[view["id"]]
        record.settings = replace(record.settings, max_seconds=0)
        self.service.approve_plan(view["id"], confirm=True)
        deadline = time.time() + 8
        while time.time() < deadline:
            view = self.service.task(view["id"])
            if view["state"] in ("done", "failed", "stopped", "cancelled"):
                break
            time.sleep(0.01)
        self.assertEqual(view["state"], "stopped")
        self.assertIn("Time limit", view["report"]["summary"])

    def test_approval_timeout_cancels_the_step(self) -> None:
        self._enable()
        view = self.service.create_task(DEMO_TASK, dry_run=False)
        record = self.service._tasks[view["id"]]
        record.settings = replace(record.settings, approval_timeout_seconds=0.05)
        step = record.plan.steps[0]
        decision = self.service.policy.decide(step, record.settings)
        result: list[bool | None] = []
        worker = threading.Thread(
            target=lambda: result.append(self.service._request_step_approval(record, step, decision))
        )
        worker.start()
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result, [None])

    def test_runtime_policy_blocks_a_tier_three_step_before_the_adapter(self) -> None:
        self._enable()
        view = self.service.create_task(DEMO_TASK, dry_run=False)
        record = self.service._tasks[view["id"]]
        step = PlanStep(
            id="danger",
            goal="Run a shell command",
            application="Terminal",
            method="desktop",
            tier=3,
            action=AgentAction("shell.run", {}),
            expected_result="never",
            verify=VerificationCheck("text_contains", "never"),
        )
        record.plan = AgentPlan(task=record.task, steps=[step], planner="test")
        record.steps = [self.service._step_record(step)]
        self.service.approve_plan(view["id"], confirm=True)
        deadline = time.time() + 5
        while time.time() < deadline:
            view = self.service.task(view["id"])
            if view["state"] in ("done", "failed", "stopped", "cancelled"):
                break
            time.sleep(0.01)
        self.assertEqual(view["state"], "stopped")
        self.assertEqual(view["report"]["status"], "Blocked")
        self.assertEqual(view["steps"][0]["status"], "blocked")

    def test_emergency_stop_disables_and_latches_the_agent(self) -> None:
        self._enable()
        view = self.service.create_task(DEMO_TASK, dry_run=False)
        stopped = self.service.emergency_stop("test")
        self.assertFalse(stopped["enabled"])
        self.assertTrue(stopped["emergency_stopped"])
        self.assertEqual(self.service.task(view["id"])["state"], "stopped")
        with self.assertRaises(AgentDisabled):
            self.service.create_task(DEMO_TASK, dry_run=False)
        with self.assertRaises(AgentError):
            self.service.update_settings({"enabled": True}, confirm=True)

    def test_screenshot_permission_requires_the_master_switch(self) -> None:
        self._enable()
        with self.assertRaises(AgentError):
            self.service.create_task(DEMO_TASK, allow_screenshots=True, screenshot_provider="ollama")

    def test_agent_refuses_a_normal_browser_profile(self) -> None:
        with self.assertRaises(AdapterError):
            BrowserAdapter(
                profile_dir=Path("C:/Users/example/AppData/Local/Google/Chrome/User Data"),
                screenshots_dir=self.data_dir / "shots",
                downloads_dir=self.data_dir / "downloads",
            )

    def test_settings_have_no_no_approval_mode(self) -> None:
        with self.assertRaises(ValueError):
            self.service.update_settings({"enabled": True, "approval_mode": "none"}, confirm=True)
        with self.assertRaises(AgentError):
            self.service.update_settings({"enabled": True}, confirm=False)


if __name__ == "__main__":
    unittest.main()
