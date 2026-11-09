"""Typed schemas for the computer-operation agent.

The planner returns JSON. Nothing from that JSON reaches a browser or the OS
until it has been parsed by these classes and checked by the deterministic
policy engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

APPROVAL_MODES = ("every_step", "tier2")
TASK_STATES = (
    "idle",
    "planning",
    "awaiting_plan_approval",
    "running",
    "awaiting_approval",
    "paused",
    "verifying",
    "done",
    "failed",
    "stopped",
    "cancelled",
)
RESULT_LEVELS = ("attempted", "accepted", "completed", "verified", "none")
STEP_STATUSES = (
    "pending",
    "running",
    "awaiting_approval",
    "verified",
    "executed",
    "attempted",
    "blocked",
    "failed",
    "skipped",
    "cancelled",
)

# A compact, typed parameter contract. Unknown parameters or wrong types are
# rejected before a step can be approved.
_ACTION_PARAMS: dict[str, dict[str, tuple[str, bool]]] = {
    "browser.open": {"url": ("string", True)},
    "browser.inspect": {},
    "browser.search": {"query": ("string", True)},
    "browser.type": {"field": ("string", True), "text": ("string", True)},
    "browser.click": {"name": ("string", True), "role": ("string", False)},
    "browser.click_link": {"text": ("string", True)},
    "browser.scroll": {"delta": ("number", False)},
    "browser.read_text": {"max_chars": ("number", False)},
    "browser.verify": {"check": ("string", True), "value": ("string", True)},
    "browser.wait": {"seconds": ("number", False)},
    "browser.screenshot": {},
    "browser.close": {},
    "browser.dismiss_consent": {},
    "browser.download": {"name": ("string", True)},
    "browser.upload": {"path": ("string", True)},
    "app.launch": {"name": ("string", False), "path": ("string", False)},
    # Tier 3 ids are recognised so the policy can refuse them explicitly.
    "shell.run": {},
    "script.run": {},
    "file.delete": {},
    "file.move": {},
    "file.rename": {},
    "system.settings": {},
    "app.install": {},
    "purchase.pay": {},
    "message.send": {},
    "email.send": {},
    "post.comment": {},
    "account.change": {},
    "security.disable": {},
    "keyboard.any": {},
    "typing.free_text": {},
}

ACTION_IDS = frozenset(_ACTION_PARAMS)
VERIFY_CHECKS = frozenset(
    {"url_contains", "title_contains", "text_contains", "element_present", "field_value_contains"}
)


class PlanValidationError(ValueError):
    """A proposed plan does not satisfy the schema or the policy contract."""


@dataclass(frozen=True)
class AgentAction:
    type: str
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_raw(cls, raw: Any) -> "AgentAction":
        if not isinstance(raw, dict):
            raise PlanValidationError("Every step needs an action object.")
        action_type = raw.get("type")
        if not isinstance(action_type, str) or not action_type.strip():
            raise PlanValidationError("An action is missing its type.")
        action_type = action_type.strip()
        schema = _ACTION_PARAMS.get(action_type)
        if schema is None:
            raise PlanValidationError(f"Unknown agent action '{action_type}'.")
        params = raw.get("params", {})
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise PlanValidationError(f"Action '{action_type}' parameters must be an object.")
        unknown = set(params) - set(schema)
        if unknown:
            raise PlanValidationError(
                f"Unexpected parameter(s) for '{action_type}': {', '.join(sorted(unknown))}."
            )
        clean: dict[str, Any] = {}
        for name, (kind, required) in schema.items():
            if name not in params:
                if required:
                    raise PlanValidationError(f"Missing parameter '{name}' for '{action_type}'.")
                continue
            value = params[name]
            if kind == "string":
                if not isinstance(value, str):
                    raise PlanValidationError(f"Parameter '{name}' must be text.")
                if len(value) > 4000:
                    raise PlanValidationError(f"Parameter '{name}' is too long.")
                if any(ord(char) < 32 and char not in "\n\t" for char in value):
                    raise PlanValidationError(f"Parameter '{name}' contains control characters.")
            else:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise PlanValidationError(f"Parameter '{name}' must be a number.")
                value = float(value)
            clean[name] = value
        return cls(type=action_type, params=clean)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "params": dict(self.params)}


@dataclass(frozen=True)
class VerificationCheck:
    check: str
    value: str = ""

    @classmethod
    def from_raw(cls, raw: Any) -> "VerificationCheck | None":
        if raw is None:
            return None
        if not isinstance(raw, dict):
            raise PlanValidationError("A verification check must be an object.")
        check = raw.get("check") or raw.get("kind")
        if check is None:
            return None
        if check not in VERIFY_CHECKS:
            raise PlanValidationError(f"Unknown verification check '{check}'.")
        value = raw.get("value", "")
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise PlanValidationError("A verification value must be text.")
        return cls(check=str(check), value=value[:500])

    def to_dict(self) -> dict[str, Any]:
        return {"check": self.check, "value": self.value}


@dataclass
class PlanStep:
    id: str
    goal: str
    application: str
    method: str
    tier: int
    action: AgentAction
    expected_result: str
    dependencies: list[str] = field(default_factory=list)
    verify: VerificationCheck | None = None

    @classmethod
    def from_raw(cls, raw: Any, index: int) -> "PlanStep":
        if not isinstance(raw, dict):
            raise PlanValidationError(f"Step {index + 1} must be an object.")
        step_id = raw.get("id")
        if not isinstance(step_id, str) or not step_id.strip():
            step_id = f"step-{index + 1}"
        step_id = step_id.strip()[:40]
        goal = raw.get("goal")
        if not isinstance(goal, str) or not goal.strip():
            raise PlanValidationError(f"Step '{step_id}' needs a goal.")
        application = raw.get("application")
        if not isinstance(application, str) or not application.strip():
            application = "Browser"
        method = raw.get("method")
        if method not in ("browser", "browser_dom", "api", "accessibility", "vision", "desktop"):
            method = "browser_dom"
        action = AgentAction.from_raw(raw.get("action"))
        tier = raw.get("tier", 1)
        if isinstance(tier, bool) or not isinstance(tier, int):
            raise PlanValidationError(f"Step '{step_id}' needs an integer tier.")
        expected = raw.get("expected_result")
        if not isinstance(expected, str) or not expected.strip():
            raise PlanValidationError(f"Step '{step_id}' needs an expected result.")
        dependencies = raw.get("dependencies", [])
        if dependencies is None:
            dependencies = []
        if not isinstance(dependencies, list) or any(not isinstance(item, str) for item in dependencies):
            raise PlanValidationError(f"Step '{step_id}' has invalid dependencies.")
        verify = VerificationCheck.from_raw(raw.get("verify"))
        return cls(
            id=step_id,
            goal=goal.strip()[:500],
            application=application.strip()[:80],
            method=str(method),
            tier=int(tier),
            action=action,
            expected_result=expected.strip()[:500],
            dependencies=[item[:40] for item in dependencies][:12],
            verify=verify,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "goal": self.goal,
            "application": self.application,
            "method": self.method,
            "tier": self.tier,
            "action": self.action.to_dict(),
            "expected_result": self.expected_result,
            "dependencies": list(self.dependencies),
            "verify": self.verify.to_dict() if self.verify else None,
        }


@dataclass
class AgentPlan:
    task: str
    steps: list[PlanStep]
    notes: list[str] = field(default_factory=list)
    planner: str = "model"

    @classmethod
    def from_raw(cls, raw: Any, task: str) -> "AgentPlan":
        if not isinstance(raw, dict):
            raise PlanValidationError("The plan must be a JSON object.")
        steps_raw = raw.get("steps")
        if not isinstance(steps_raw, list) or not steps_raw:
            raise PlanValidationError("The plan needs at least one step.")
        if len(steps_raw) > 40:
            raise PlanValidationError("The plan has too many steps.")
        steps = [PlanStep.from_raw(item, index) for index, item in enumerate(steps_raw)]
        ids = [step.id for step in steps]
        if len(ids) != len(set(ids)):
            raise PlanValidationError("Plan step ids must be unique.")
        known = set(ids)
        for step in steps:
            missing = [item for item in step.dependencies if item not in known]
            if missing:
                raise PlanValidationError(
                    f"Step '{step.id}' depends on unknown step(s): {', '.join(missing)}."
                )
        notes_raw = raw.get("notes")
        notes = []
        if isinstance(notes_raw, list):
            notes = [str(item)[:300] for item in notes_raw if str(item).strip()][:8]
        planner = str(raw.get("planner") or "model")
        return cls(task=task, steps=steps, notes=notes, planner=planner)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "steps": [step.to_dict() for step in self.steps],
            "notes": list(self.notes),
            "planner": self.planner,
        }


@dataclass(frozen=True)
class Observation:
    application: str
    url: str
    title: str
    text: str
    hidden_text: str = ""
    elements: list[dict[str, Any]] = field(default_factory=list)
    consent_banner: str | None = None
    login_or_payment: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "application": self.application,
            "url": self.url,
            "title": self.title,
            "text": self.text,
            "hidden_text": self.hidden_text,
            "elements": list(self.elements),
            "consent_banner": self.consent_banner,
            "login_or_payment": self.login_or_payment,
        }


@dataclass
class ActionResult:
    action_id: str
    level: Literal["attempted", "accepted", "completed", "verified", "none"]
    ok: bool
    detail: str
    method: str = "browser_dom"
    evidence: dict[str, Any] | None = None
    verified: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "level": self.level,
            "ok": self.ok,
            "detail": self.detail,
            "method": self.method,
            "evidence": dict(self.evidence) if self.evidence else None,
            "verified": self.verified,
        }


@dataclass(frozen=True)
class AgentSettings:
    enabled: bool = False
    approval_mode: str = "every_step"
    ask_new_domain: bool = True
    screenshot_to_provider: bool = False
    dry_run: bool = True
    max_steps: int = 25
    max_seconds: int = 300
    approval_timeout_seconds: int = 30
    domains: tuple[str, ...] = ()

    def validate(self) -> "AgentSettings":
        if self.approval_mode not in APPROVAL_MODES:
            raise ValueError("Approval mode must be 'every_step' or 'tier2'. There is no no-approval mode.")
        if not 1 <= self.max_steps <= 25:
            raise ValueError("max_steps must be between 1 and 25.")
        if not 30 <= self.max_seconds <= 900:
            raise ValueError("max_seconds must be between 30 and 900.")
        if not 10 <= self.approval_timeout_seconds <= 30:
            raise ValueError("approval_timeout_seconds must be between 10 and 30.")
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "approval_mode": self.approval_mode,
            "ask_new_domain": self.ask_new_domain,
            "screenshot_to_provider": self.screenshot_to_provider,
            "dry_run": self.dry_run,
            "max_steps": self.max_steps,
            "max_seconds": self.max_seconds,
            "approval_timeout_seconds": self.approval_timeout_seconds,
            "domains": list(self.domains),
        }
