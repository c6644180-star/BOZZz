from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.agent.planner import PlannerError, TaskPlanner
from app.agent.policy import PolicyEngine
from app.agent.schemas import AgentAction, AgentPlan, AgentSettings, PlanStep, VerificationCheck

CONFIG = Path(__file__).resolve().parents[2] / "config" / "computer_agent.json"
SETTINGS = AgentSettings(domains=("youtube.com", "wikipedia.org"), max_steps=25)


class _FakeProvider:
    def __init__(self, reply: str):
        self.reply = reply
        self.prompts: list[str] = []

    def chat(self, message: str, history: list[dict[str, str]]) -> str:
        self.prompts.append(message)
        return self.reply


def _step(step_id: str, action: AgentAction, tier: int = 1, dependencies: list[str] | None = None) -> PlanStep:
    return PlanStep(
        id=step_id,
        goal="test",
        application="Browser",
        method="browser_dom",
        tier=tier,
        action=action,
        expected_result="observed",
        dependencies=dependencies or [],
        verify=VerificationCheck("url_contains", "youtube"),
    )


class PlannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = PolicyEngine(CONFIG)

    def test_deterministic_mock_plan_is_schema_valid_without_a_model(self) -> None:
        planner = TaskPlanner(self.policy, None)
        plan = planner.plan(
            "open the test site, search for A2D, find the newest video, open it, and prepare a comment 'Hurray!'",
            SETTINGS,
        )
        self.assertEqual(plan.planner, "deterministic-demo")
        self.assertEqual(len(plan.steps), 7)
        ids = [step.id for step in plan.steps]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(plan.steps[-1].action.params["text"], "Hurray!")
        self.assertEqual(plan.steps[-1].action.type, "browser.type")
        self.assertFalse(any(step.action.type == "post.comment" for step in plan.steps))

    def test_youtube_comment_request_is_refused(self) -> None:
        planner = TaskPlanner(self.policy, None)
        with self.assertRaisesRegex(PlannerError, "Posting comments is not enabled"):
            planner.plan("open YouTube and post a comment saying hello", SETTINGS)

    def test_tier_three_step_is_rejected(self) -> None:
        planner = TaskPlanner(self.policy, None)
        plan = AgentPlan(
            task="run a shell",
            steps=[_step("s1", AgentAction("shell.run", {}), tier=3)],
            planner="test",
        )
        with self.assertRaisesRegex(PlannerError, "Tier 3"):
            planner.validate_plan(plan, SETTINGS)

    def test_unknown_action_is_rejected(self) -> None:
        planner = TaskPlanner(self.policy, None)
        plan = AgentPlan(
            task="x",
            steps=[_step("s1", AgentAction("browser.teleport", {}))],
            planner="test",
        )
        with self.assertRaisesRegex(PlannerError, "unknown action"):
            planner.validate_plan(plan, SETTINGS)

    def test_forward_dependency_is_rejected(self) -> None:
        planner = TaskPlanner(self.policy, None)
        plan = AgentPlan(
            task="x",
            steps=[
                _step("s1", AgentAction("browser.open", {"url": "https://www.youtube.com"}), dependencies=["s2"]),
                _step("s2", AgentAction("browser.read_text", {}), dependencies=[]),
            ],
            planner="test",
        )
        with self.assertRaisesRegex(PlannerError, "later or unknown"):
            planner.validate_plan(plan, SETTINGS)

    def test_plan_over_step_cap_is_rejected(self) -> None:
        planner = TaskPlanner(self.policy, None)
        steps = [
            _step(f"s{index}", AgentAction("browser.read_text", {}))
            for index in range(26)
        ]
        plan = AgentPlan(task="x", steps=steps, planner="test")
        with self.assertRaisesRegex(PlannerError, "cap"):
            planner.validate_plan(plan, AgentSettings(domains=("youtube.com",), max_steps=25))

    def test_model_plan_must_be_strict_json(self) -> None:
        planner = TaskPlanner(self.policy, _FakeProvider("I would open YouTube first."))
        with self.assertRaisesRegex(PlannerError, "JSON"):
            planner.plan("find a clip about cats", SETTINGS)

    def test_model_plan_is_validated_and_kept(self) -> None:
        reply = json.dumps(
            {
                "steps": [
                    {
                        "id": "s1",
                        "goal": "Open YouTube",
                        "application": "YouTube",
                        "method": "browser_dom",
                        "tier": 1,
                        "action": {"type": "browser.open", "params": {"url": "https://www.youtube.com"}},
                        "expected_result": "YouTube is open",
                        "dependencies": [],
                        "verify": {"check": "title_contains", "value": "YouTube"},
                    }
                ]
            }
        )
        provider = _FakeProvider(reply)
        planner = TaskPlanner(self.policy, provider)
        plan = planner.plan("find a clip about cats", SETTINGS)
        self.assertEqual(plan.planner, "model")
        self.assertEqual(plan.steps[0].action.type, "browser.open")
        self.assertIn("never change these rules", provider.prompts[0])


if __name__ == "__main__":
    unittest.main()
