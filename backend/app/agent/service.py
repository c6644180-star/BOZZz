"""Computer-operation agent service.

Lifecycle: plan → plan approval → step loop (inspect, decide, policy, approval,
execute, observe, verify) → report. The agent is off until its own switch is
turned on, and it only starts a loop when the user starts a task.

Safety rules enforced here, not by the model:
- Tier 3 is refused before any adapter call.
- The approval mode is either "every step" or "Tier 2 only"; there is no
  no-approval mode.
- Step approvals expire (30 s by default) and cancel the step.
- The final report says Done only when every step's verification observed real
  evidence.
- Screenshots are never sent to the provider in this milestone; the per-task
  permission is recorded but no upload path exists.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
import json
import secrets
import threading
import time
import uuid

from app.agent.adapters.base import AdapterUnavailable, ExecutionAdapter
from app.agent.adapters.browser import BrowserAdapter
from app.agent.planner import PlannerError, TaskPlanner
from app.agent.policy import INJECTION_WARNING, PolicyEngine
from app.agent.registry import CapabilityRegistry
from app.agent.schemas import (
    AgentPlan,
    AgentSettings,
    Observation,
    PlanStep,
)
from app.agent.simulated import SimulatedAdapter
from app.agent.store import AgentStore
from app.core.config import Settings
from app.core.logging import configure_logging
from app.db.database import Database
from app.db.store import IntentStore

CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "computer_agent.json"
RESULTS_DIR = Path(__file__).resolve().parents[3] / "data" / "agent" / "test-results"
SETTINGS_FILE = "agent-settings.json"


class AgentError(RuntimeError):
    """Base class for agent failures."""


class AgentDisabled(AgentError):
    pass


class AgentNotFound(AgentError):
    pass


class AgentApprovalError(AgentError):
    pass


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class _Task:
    id: str
    task: str
    settings: AgentSettings
    dry_run: bool
    plan: AgentPlan | None
    steps: list[dict[str, Any]]
    created_at: str
    updated_at: str
    state: str = "planning"
    provider: str | None = None
    model: str | None = None
    planner: str | None = None
    report: dict[str, Any] | None = None
    current_step_id: str | None = None
    pending_approval: dict[str, Any] | None = None
    approval_result: bool | None = None
    paused: bool = False
    handoff: bool = False
    notes: list[str] = field(default_factory=list)
    injection_warnings: list[str] = field(default_factory=list)
    screenshots_allowed: bool = False
    screenshot_provider: str | None = None
    started_monotonic: float | None = None
    started_at: str | None = None
    finished_at: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    adapter: ExecutionAdapter | None = None
    elapsed_ms: int = 0

    def to_store(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "task": self.task,
            "state": self.state,
            "dry_run": self.dry_run,
            "plan": self.plan.to_dict() if self.plan else None,
            "steps": list(self.steps),
            "report": self.report,
            "provider": self.provider,
            "model": self.model,
            "planner": self.planner,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class AgentService:
    def __init__(
        self,
        settings: Settings,
        *,
        provider: Any = None,
        policy: PolicyEngine | None = None,
        registry: CapabilityRegistry | None = None,
        adapter_factory: Callable[[_Task], ExecutionAdapter] | None = None,
        database: Database | None = None,
    ):
        self.settings = settings
        self.policy = policy or PolicyEngine(CONFIG_PATH)
        self.registry = registry or CapabilityRegistry(results_dir=RESULTS_DIR)
        database = database or Database(settings.database_path)
        self._intent_store = IntentStore(database)
        self._store = AgentStore(database)
        self._provider = provider
        self._planner = TaskPlanner(self.policy, provider)
        self._adapter_factory = adapter_factory
        self._logger = configure_logging(settings.log_level).getChild("agent")
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._tasks: dict[str, _Task] = {}
        self._enabled = False
        self._emergency_stopped = False
        self._settings = self._load_settings()
        self._active_task_id: str | None = None
        self._data_dir = Path(settings.data_dir) / "agent"
        self._data_dir.mkdir(parents=True, exist_ok=True)

    # ----------------------------------------------------------------- settings

    def _settings_path(self) -> Path:
        return Path(self.settings.data_dir) / SETTINGS_FILE

    def _default_settings(self) -> AgentSettings:
        payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        defaults = payload.get("defaults") or {}
        return AgentSettings(
            enabled=False,
            approval_mode=str(defaults.get("approval_mode") or "every_step"),
            ask_new_domain=bool(defaults.get("ask_new_domain", True)),
            screenshot_to_provider=bool(defaults.get("screenshot_to_provider", False)),
            dry_run=bool(defaults.get("dry_run", True)),
            max_steps=int(defaults.get("max_steps") or 25),
            max_seconds=int(defaults.get("max_seconds") or 300),
            approval_timeout_seconds=int(defaults.get("approval_timeout_seconds") or 30),
            domains=tuple(self.policy.domains),
        )

    def _load_settings(self) -> AgentSettings:
        base = self._default_settings()
        path = self._settings_path()
        if not path.is_file():
            return base
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return base
        if not isinstance(payload, dict):
            return base
        try:
            return AgentSettings(
                enabled=bool(payload.get("enabled", False)),
                approval_mode=str(payload.get("approval_mode") or base.approval_mode),
                ask_new_domain=bool(payload.get("ask_new_domain", base.ask_new_domain)),
                screenshot_to_provider=bool(payload.get("screenshot_to_provider", base.screenshot_to_provider)),
                dry_run=bool(payload.get("dry_run", base.dry_run)),
                max_steps=int(payload.get("max_steps") or base.max_steps),
                max_seconds=int(payload.get("max_seconds") or base.max_seconds),
                approval_timeout_seconds=int(
                    payload.get("approval_timeout_seconds") or base.approval_timeout_seconds
                ),
                domains=tuple(str(item) for item in payload.get("domains", base.domains)),
            ).validate()
        except (ValueError, TypeError):
            return base

    def _save_settings(self, settings: AgentSettings) -> None:
        path = self._settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(settings.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)

    def settings_view(self) -> dict[str, Any]:
        with self._lock:
            return {**self._settings.to_dict(), "emergency_stopped": self._emergency_stopped}

    def update_settings(self, patch: dict[str, Any], *, confirm: bool = False) -> dict[str, Any]:
        with self._lock:
            current = self._settings
            enabled = current.enabled
            emergency = self._emergency_stopped
            if "enabled" in patch:
                requested = bool(patch["enabled"])
                if requested and not current.enabled:
                    if not confirm:
                        raise AgentError("Turning the agent on needs an explicit confirmation.")
                    if emergency:
                        raise AgentError("Emergency stop is latched. Restart the backend or confirm a reset first.")
                enabled = requested
                if not requested:
                    self._stop_all_locked("the agent switch was turned off")
            approval_mode = str(patch.get("approval_mode", current.approval_mode))
            domains = current.domains
            if "domains" in patch:
                raw_domains = patch["domains"]
                if not isinstance(raw_domains, list):
                    raise AgentError("The domain allowlist must be a list.")
                cleaned: list[str] = []
                for item in raw_domains[:40]:
                    value = str(item).strip().casefold()
                    if not value:
                        continue
                    if any(char.isspace() for char in value) or "/" in value or ":" in value:
                        raise AgentError(f"'{item}' is not a bare domain name.")
                    if value not in cleaned:
                        cleaned.append(value)
                domains = tuple(cleaned)
            next_settings = AgentSettings(
                enabled=enabled,
                approval_mode=approval_mode,
                ask_new_domain=bool(patch.get("ask_new_domain", current.ask_new_domain)),
                screenshot_to_provider=bool(
                    patch.get("screenshot_to_provider", current.screenshot_to_provider)
                ),
                dry_run=bool(patch.get("dry_run", current.dry_run)),
                max_steps=int(patch.get("max_steps", current.max_steps)),
                max_seconds=int(patch.get("max_seconds", current.max_seconds)),
                approval_timeout_seconds=int(
                    patch.get("approval_timeout_seconds", current.approval_timeout_seconds)
                ),
                domains=domains,
            ).validate()
            if "reset_emergency" in patch and bool(patch["reset_emergency"]):
                if not confirm:
                    raise AgentError("Resetting the emergency stop needs an explicit confirmation.")
                self._emergency_stopped = False
                emergency = False
            self._settings = next_settings
            self._enabled = next_settings.enabled
            self._save_settings(next_settings)
            self._audit(
                None,
                "settings",
                "updated",
                f"Agent settings updated: enabled={enabled} approval={approval_mode} "
                f"domains={len(domains)} screenshots_to_provider={next_settings.screenshot_to_provider}.",
            )
            return {**next_settings.to_dict(), "emergency_stopped": emergency}

    # ------------------------------------------------------------------- status

    def status(self) -> dict[str, Any]:
        with self._lock:
            active = self._tasks.get(self._active_task_id or "")
            tasks = self._store.list_tasks(20) if self._store else []
            browser_installed = bool(BrowserAdapter(
                profile_dir=self._data_dir / "agent-profile",
                screenshots_dir=self._data_dir / "agent-screenshots",
                downloads_dir=self._data_dir / "agent-downloads",
            ).available)
            return {
                "version": 1,
                "enabled": self._enabled,
                "emergency_stopped": self._emergency_stopped,
                "settings": self._settings.to_dict(),
                "policy": {
                    "approval_modes": ["every_step", "tier2"],
                    "no_approval_mode": False,
                    "tiers": {
                        str(spec.tier): f"Tier {spec.tier}" for spec in self.policy.actions.values()
                    },
                    "actions": [
                        {"id": spec.id, "tier": spec.tier, "label": spec.label, "risk": spec.risk}
                        for spec in sorted(self.policy.actions.values(), key=lambda item: (item.tier, item.id))
                    ],
                    "domains": list(self._settings.domains),
                    "test_site": f"http://127.0.0.1:8000{self.policy.test_prefix}",
                    "limits": {
                        "max_steps": self._settings.max_steps,
                        "max_seconds": self._settings.max_seconds,
                        "approval_timeout_seconds": self._settings.approval_timeout_seconds,
                    },
                },
                "adapters": {
                    "browser": {
                        "installed": browser_installed,
                        "profile": str(self._data_dir / "agent-profile"),
                        "fresh_profile": True,
                        "headed": True,
                        "detail": (
                            "Playwright is installed; Chromium starts only when a task runs."
                            if browser_installed
                            else "Playwright is not installed. Run: pip install playwright && python -m playwright install chromium"
                        ),
                    },
                    "official_api": {"available": False, "detail": "Documented stub; no provider in this milestone."},
                    "accessibility": {
                        "available": False,
                        "detail": "Windows UI Automation is planned for Milestone 2.",
                    },
                    "desktop": {
                        "available": False,
                        "detail": "The agent never turns Desktop Control on; it can proxy Tier 1 only when already on.",
                    },
                },
                "method_order": ["api", "accessibility", "browser_dom", "vision", "desktop"],
                "active_task": self._task_view(active) if active else None,
                "tasks": tasks,
                "capabilities": self.registry.profiles_view(),
                "screenshot_policy": {
                    "default": False,
                    "master_switch": self._settings.screenshot_to_provider,
                    "upload_path_exists": False,
                    "notice": (
                        "Screenshots stay in the local BOZZ data folder. Milestone 1 has no code that sends a "
                        "screenshot to an AI provider, even when the per-task permission is on."
                    ),
                },
            }

    # -------------------------------------------------------------------- tasks

    def create_task(
        self,
        task: str,
        *,
        dry_run: bool | None = None,
        allow_screenshots: bool = False,
        screenshot_provider: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if not self._enabled:
                raise AgentDisabled("The computer agent is off. Turn it on in Settings before starting a task.")
            if self._emergency_stopped:
                raise AgentDisabled("Emergency stop is latched. Reset it before starting a task.")
            settings = self._settings
            if allow_screenshots:
                if not settings.screenshot_to_provider:
                    raise AgentError("Screenshot sharing is off in Settings; this task cannot enable it.")
                if not (screenshot_provider or "").strip():
                    raise AgentError("Name the AI provider before enabling screenshots for a task.")
            use_dry_run = settings.dry_run if dry_run is None else bool(dry_run)
            provider_name = getattr(self._provider, "provider_name", None) if self._provider else None
            model_name = getattr(self._provider, "configured_model", None) if self._provider else None
            task_id = uuid.uuid4().hex
            created = _iso_now()
            record = _Task(
                id=task_id,
                task=task.strip(),
                settings=settings,
                dry_run=use_dry_run,
                plan=None,
                steps=[],
                created_at=created,
                updated_at=created,
                state="planning",
                provider=provider_name or "deterministic",
                model=model_name or "demo-planner",
                screenshots_allowed=bool(allow_screenshots),
                screenshot_provider=(screenshot_provider or "").strip() or None,
            )
            self._tasks[task_id] = record
            self._audit(
                record,
                "plan_requested",
                "started",
                f"Task started in {'dry-run' if use_dry_run else 'live'} mode.",
            )
            if allow_screenshots:
                self._audit(
                    record,
                    "screenshot_permission",
                    "noted",
                    f"Screenshot permission requested for provider {record.screenshot_provider}. "
                    "No screenshot upload path exists in this milestone.",
                )
        try:
            plan = self._planner.plan(record.task, settings)
        except PlannerError as exc:
            with self._lock:
                record.state = "failed"
                record.report = {
                    "status": "Could not plan",
                    "summary": str(exc),
                    "result_level": "none",
                    "verification": {"ok": False, "detail": "No plan was created."},
                    "steps": [],
                    "elapsed_ms": 0,
                    "dry_run": use_dry_run,
                }
                record.updated_at = _iso_now()
                self._store.save_task(record.to_store())
                self._audit(record, "plan_rejected", "failed", str(exc)[:500])
                return self._task_view(record)
        with self._lock:
            record.plan = plan
            record.planner = plan.planner
            record.steps = [self._step_record(step) for step in plan.steps]
            record.state = "awaiting_plan_approval"
            record.notes.extend(plan.notes)
            record.updated_at = _iso_now()
            self._store.save_task(record.to_store())
            self._audit(
                record,
                "plan",
                "awaiting_approval",
                f"{len(plan.steps)} step(s) planned by {plan.planner}; waiting for plan approval.",
            )
            return self._task_view(record)

    def approve_plan(self, task_id: str, confirm: bool = False) -> dict[str, Any]:
        if not confirm:
            raise AgentApprovalError("The plan needs an explicit approval.")
        with self._lock:
            record = self._require(task_id)
            if record.state != "awaiting_plan_approval":
                raise AgentError(f"Task is '{record.state}', not awaiting plan approval.")
            record.state = "running"
            record.updated_at = _iso_now()
            self._audit(record, "plan_approved", "approved", "The user approved the plan preview.")
            thread = threading.Thread(target=self._execute_task, args=(record,), name=f"agent-{task_id}", daemon=True)
            record.thread = thread
            self._active_task_id = task_id
            thread.start()
            return self._task_view(record)

    def reject_plan(self, task_id: str, reason: str = "") -> dict[str, Any]:
        with self._lock:
            record = self._require(task_id)
            if record.state != "awaiting_plan_approval":
                raise AgentError(f"Task is '{record.state}', not awaiting plan approval.")
            record.state = "cancelled"
            record.report = self._report(record, "Rejected", f"Plan rejected. {reason}".strip(), "none", [])
            record.updated_at = _iso_now()
            self._store.save_task(record.to_store())
            self._audit(record, "plan_rejected", "rejected", f"Plan rejected by the user. {reason}".strip())
            return self._task_view(record)

    def pause(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            record = self._require(task_id)
            if record.state not in ("running", "awaiting_approval", "verifying"):
                raise AgentError(f"Task is '{record.state}' and cannot be paused.")
            record.paused = True
            record.state = "paused"
            record.updated_at = _iso_now()
            self._audit(record, "pause", "paused", "The user paused the agent.")
            self._condition.notify_all()
            return self._task_view(record)

    def resume(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            record = self._require(task_id)
            if not record.paused:
                raise AgentError("Task is not paused.")
            record.paused = False
            record.handoff = False
            record.state = "running"
            record.updated_at = _iso_now()
            self._audit(record, "resume", "running", "The user pressed Continue.")
            record.notes = [note for note in record.notes if "Please log in yourself" not in note]
            self._condition.notify_all()
            return self._task_view(record)

    def cancel(self, task_id: str, reason: str = "The user cancelled the task.") -> dict[str, Any]:
        with self._lock:
            record = self._require(task_id)
            if record.state in ("done", "failed", "stopped", "cancelled"):
                return self._task_view(record)
            record.cancel.set()
            record.paused = False
            record.pending_approval = None
            record.approval_result = None
            record.state = "stopped"
            record.report = self._report(record, "Stopped", reason, "none", [])
            record.updated_at = _iso_now()
            self._audit(record, "cancel", "stopped", reason)
            self._condition.notify_all()
            if self._active_task_id == task_id:
                self._active_task_id = None
            return self._task_view(record)

    def approve_step(self, task_id: str, approval_id: str, approve: bool) -> dict[str, Any]:
        with self._lock:
            record = self._require(task_id)
            pending = record.pending_approval
            if record.state != "awaiting_approval" or not pending:
                raise AgentApprovalError("There is no step waiting for approval.")
            if not secrets.compare_digest(str(pending.get("approval_id")), str(approval_id)):
                raise AgentApprovalError("That approval does not belong to the pending step.")
            if time.monotonic() > float(pending.get("expires_monotonic") or 0):
                raise AgentApprovalError("That approval expired. The step is being cancelled.")
            record.approval_result = bool(approve)
            record.state = "running" if approve else "stopped"
            record.pending_approval = None
            record.updated_at = _iso_now()
            self._audit(
                record,
                "step_approval",
                "approved" if approve else "denied",
                f"The user {'approved' if approve else 'denied'} step {pending.get('step_id')}.",
            )
            self._condition.notify_all()
            return self._task_view(record)

    def emergency_stop(self, reason: str = "manual") -> dict[str, Any]:
        with self._lock:
            self._emergency_stopped = True
            self._enabled = False
            self._settings = AgentSettings(**{**self._settings.to_dict(), "enabled": False, "domains": self._settings.domains})
            self._save_settings(self._settings)
            for record in self._tasks.values():
                if record.state in ("done", "failed", "stopped", "cancelled"):
                    continue
                record.cancel.set()
                record.paused = False
                record.pending_approval = None
                record.approval_result = False
                record.state = "stopped"
                record.report = self._report(record, "Stopped", f"Emergency stop: {reason}.", "none", [])
                record.updated_at = _iso_now()
                self._audit(record, "emergency_stop", "stopped", f"Emergency stop: {reason}.")
            self._active_task_id = None
            self._audit(None, "emergency_stop", "stopped", f"Emergency stop: {reason}.")
            self._condition.notify_all()
            return self.status()

    def task(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            record = self._tasks.get(task_id)
            if record is not None:
                return self._task_view(record)
        stored = self._store.get_task(task_id)
        if stored is None:
            raise AgentNotFound(f"Agent task '{task_id}' was not found.")
        stored["pending_approval"] = None
        stored["injection_warnings"] = []
        stored["notes"] = []
        return stored

    def tasks(self, limit: int = 20) -> list[dict[str, Any]]:
        return self._store.list_tasks(limit)

    def audit(self, limit: int = 100) -> list[dict[str, Any]]:
        return [
            entry
            for entry in self._intent_store.list_audit(limit * 3)
            if str(entry.get("event") or "").startswith("agent_")
        ][:limit]

    # ------------------------------------------------------------------ execute

    def _execute_task(self, record: _Task) -> None:
        adapter: ExecutionAdapter | None = None
        try:
            if record.dry_run:
                self._run_dry(record)
                return
            adapter = self._make_adapter(record)
            record.adapter = adapter
            with self._lock:
                record.started_monotonic = time.monotonic()
                record.started_at = _iso_now()
                record.state = "running"
                record.updated_at = _iso_now()
            adapter.start()
            observation = adapter.observe()
            self._scan_observation(record, observation)
            notes = self.policy.observation_hints(observation)
            for note in notes:
                if note not in record.notes:
                    record.notes.append(note)
            if observation.consent_banner:
                result = adapter.dismiss_consent() if hasattr(adapter, "dismiss_consent") else None
                detail = getattr(result, "detail", None) or "The banner was left untouched."
                record.notes.append(f"Cookie banner: {detail}")
                self._audit(record, "consent", "handled" if getattr(result, "ok", False) else "not_handled", detail)
            if observation.login_or_payment:
                self._handoff(record, "A login or payment form is visible. Please log in yourself, then press Continue.")
            started = time.monotonic()
            for index, step in enumerate(record.plan.steps if record.plan else []):
                if record.cancel.is_set():
                    break
                if not self._wait_if_paused(record):
                    break
                elapsed = time.monotonic() - started
                if elapsed > record.settings.max_seconds:
                    record.state = "stopped"
                    record.report = self._report(
                        record,
                        "Stopped",
                        f"Time limit of {record.settings.max_seconds}s reached.",
                        "none",
                        [],
                        elapsed,
                    )
                    self._audit(record, "time_cap", "stopped", f"Stopped after {elapsed:.1f}s.")
                    break
                if index >= record.settings.max_steps:
                    record.state = "stopped"
                    record.report = self._report(
                        record, "Stopped", f"Step limit of {record.settings.max_steps} reached.", "none", [], elapsed
                    )
                    self._audit(record, "step_cap", "stopped", "Step limit reached.")
                    break
                keep_going = self._execute_step(record, adapter, index, step, started)
                if not keep_going:
                    break
            else:
                got_all = all(item.get("status") == "verified" for item in record.steps)
                if got_all:
                    record.state = "done"
                    record.report = self._report(
                        record,
                        "Done",
                        "Every step was independently verified by a fresh observation.",
                        "verified",
                        [],
                        time.monotonic() - started,
                    )
                else:
                    record.state = "failed"
                    unverified = [
                        item["id"] for item in record.steps if item.get("status") != "verified"
                    ]
                    record.report = self._report(
                        record,
                        "Executed, not verified",
                        "The plan ran, but these steps have no passing verification evidence: "
                        + ", ".join(unverified)
                        + ".",
                        "completed",
                        [],
                        time.monotonic() - started,
                    )
            if record.state in ("done", "failed", "stopped", "cancelled") and record.report:
                record.elapsed_ms = int(float(record.report.get("elapsed_ms") or 0))
                record.finished_at = _iso_now()
                record.updated_at = record.finished_at
                self._store.save_task(record.to_store())
                self._audit(
                    record,
                    "report",
                    str(record.report.get("status") or record.state).lower(),
                    f"Final report: {record.report.get('status')}. {record.report.get('summary')}"[:900],
                )
        except AdapterUnavailable as exc:
            with self._lock:
                record.state = "failed"
                record.report = self._report(record, "Could not start", str(exc), "none", [])
                record.updated_at = _iso_now()
                self._store.save_task(record.to_store())
                self._audit(record, "adapter_unavailable", "failed", str(exc)[:500])
        except Exception as exc:  # noqa: BLE001 - a task must stop safely
            self._logger.exception("agent task failed")
            with self._lock:
                record.state = "failed"
                record.report = self._report(record, "Stopped safely", f"Unexpected failure: {exc}", "none", [])
                record.updated_at = _iso_now()
                self._store.save_task(record.to_store())
                self._audit(record, "error", "failed", f"Unexpected failure: {exc}"[:500])
        finally:
            try:
                if adapter is not None:
                    adapter.close()
            except Exception:  # noqa: BLE001
                pass
            with self._lock:
                if self._active_task_id == record.id and record.state in ("done", "failed", "stopped", "cancelled"):
                    self._active_task_id = None
                if record.started_monotonic is not None and record.elapsed_ms == 0:
                    record.elapsed_ms = int((time.monotonic() - record.started_monotonic) * 1000)

    def _execute_step(self, record: _Task, adapter: ExecutionAdapter, index: int, step: PlanStep, started: float) -> bool:
        state = record.steps[index]
        state["status"] = "running"
        state["detail"] = "Inspecting the current state."
        record.current_step_id = step.id
        record.state = "running"
        record.updated_at = _iso_now()
        self._store.save_task(record.to_store())
        observation = adapter.observe()
        if self._scan_observation(record, observation):
            state["injection_warning"] = True
        if observation.login_or_payment and step.action.type in ("browser.type", "browser.click", "browser.download"):
            self._handoff(record, "A login or payment form is visible. Please log in yourself, then press Continue.")
            if not self._wait_if_paused(record):
                state["status"] = "cancelled"
                return False
            observation = adapter.observe()
            self._scan_observation(record, observation)
        decision = self.policy.decide(step, record.settings, observation)
        state["policy"] = {
            "tier": decision.tier,
            "label": decision.label,
            "allowed": decision.allowed,
            "reason": decision.reason,
            "requires_approval": decision.requires_approval,
            "needs_domain_approval": decision.needs_domain_approval,
        }
        for warning in decision.warnings:
            if warning not in record.notes:
                record.notes.append(warning)
        if not decision.allowed:
            state["status"] = "blocked"
            state["level"] = "none"
            state["detail"] = decision.reason
            record.state = "stopped"
            record.report = self._report(
                record,
                "Blocked",
                f"Step '{step.goal}' was blocked: {decision.reason}",
                "none",
                [],
                time.monotonic() - started,
            )
            self._audit(record, "block", "blocked", f"{decision.label}: {decision.reason}"[:400], step)
            self._store.save_task(record.to_store())
            return False
        if decision.handoff:
            self._handoff(record, decision.reason)
            if not self._wait_if_paused(record):
                state["status"] = "cancelled"
                return False
            observation = adapter.observe()
            self._scan_observation(record, observation)
            decision = self.policy.decide(step, record.settings, observation)
            if not decision.allowed:
                state["status"] = "blocked"
                state["level"] = "none"
                state["detail"] = decision.reason
                record.state = "stopped"
                record.report = self._report(
                    record, "Blocked", decision.reason, "none", [], time.monotonic() - started
                )
                self._audit(record, "block", "blocked", decision.reason[:400], step)
                self._store.save_task(record.to_store())
                return False
        if decision.requires_approval:
            approved = self._request_step_approval(record, step, decision)
            if approved is None:
                state["status"] = "cancelled"
                state["level"] = "none"
                state["detail"] = "The approval expired; the step was cancelled."
                record.state = "stopped"
                record.report = self._report(
                    record,
                    "Stopped",
                    "Step approval expired after "
                    f"{record.settings.approval_timeout_seconds}s; nothing further ran.",
                    "none",
                    [],
                    time.monotonic() - started,
                )
                self._audit(record, "approval_timeout", "stopped", f"Step {step.id} approval expired.", step)
                self._store.save_task(record.to_store())
                return False
            if approved is False:
                state["status"] = "cancelled"
                state["level"] = "none"
                state["detail"] = "The user denied the step."
                record.state = "stopped"
                record.report = self._report(
                    record, "Stopped", f"The user denied step '{step.goal}'. Nothing was executed.", "none", [], time.monotonic() - started
                )
                self._store.save_task(record.to_store())
                return False
        # Execute only after the policy and the approval gate.
        result = adapter.act(step.action)
        state["method"] = result.method
        state["level"] = result.level
        state["detail"] = result.detail
        state["action_id"] = step.action.type
        self._audit(
            record,
            "action",
            "attempted" if not result.ok else "accepted",
            f"{decision.label}: {result.detail}"[:500],
            step,
        )
        if not result.ok:
            retryable = step.action.type in ("browser.type", "browser.click_link", "browser.open", "browser.scroll")
            if retryable:
                record.notes.append(f"Step '{step.id}' failed once; re-inspecting and retrying once.")
                adapter.observe()
                result = adapter.act(step.action)
                state["detail"] = result.detail
                state["level"] = result.level
            if not result.ok:
                state["status"] = "failed"
                record.state = "failed"
                record.report = self._report(
                    record,
                    "Could not confirm",
                    f"Step '{step.goal}' failed: {result.detail}",
                    "attempted",
                    [],
                    time.monotonic() - started,
                )
                self._audit(record, "action_failed", "failed", result.detail[:400], step)
                self._store.save_task(record.to_store())
                return False
        record.state = "verifying"
        verification = step.verify
        if verification is None and step.action.type == "browser.verify":
            evidence = result.evidence or {}
            ok = bool(result.verified)
            detail = result.detail
            source = str(evidence.get("source") or result.method)
        elif verification is not None:
            ok, detail, evidence = adapter.verify(verification)
            source = str((evidence or {}).get("source") or result.method)
        else:
            ok, detail, evidence, source = False, "No independent verification check was defined.", None, result.method
        if not ok and verification is not None:
            time.sleep(1.0)
            adapter.observe()
            ok, detail, evidence = adapter.verify(verification)
            source = str((evidence or {}).get("source") or result.method)
        state["verification"] = {
            "ok": bool(ok),
            "detail": detail,
            "source": source,
            "evidence": evidence,
        }
        if ok:
            state["status"] = "verified"
            state["level"] = "verified"
            state["detail"] = f"{result.detail} Verified: {detail}"
            self._audit(record, "verified", "verified", f"{decision.label}: {detail}"[:500], step)
        else:
            state["status"] = "executed"
            state["level"] = "completed"
            state["detail"] = f"{result.detail} Executed, not verified: {detail}"
            record.state = "failed"
            record.report = self._report(
                record,
                "Executed, not verified",
                f"Step '{step.goal}' ran but its verification failed: {detail}",
                "completed",
                [],
                time.monotonic() - started,
            )
            self._audit(record, "verify_failed", "failed", detail[:400], step)
            self._store.save_task(record.to_store())
            return False
        record.state = "running"
        record.updated_at = _iso_now()
        self._store.save_task(record.to_store())
        return True

    def _run_dry(self, record: _Task) -> None:
        started = time.monotonic()
        with self._lock:
            for index, step in enumerate(record.plan.steps if record.plan else []):
                state = record.steps[index]
                state["status"] = "attempted"
                state["level"] = "attempted"
                state["detail"] = (
                    f"Dry run — would use {step.method} and Tier {step.tier} for '{step.goal}'. "
                    "Nothing was executed."
                )
                self._audit(record, "dry_run", "attempted", f"Would run {step.action.type} (Tier {step.tier}).", step)
            record.state = "done"
            record.report = self._report(
                record,
                "Dry run",
                "Dry run finished. Nothing was opened, typed, clicked or submitted.",
                "attempted",
                [],
                time.monotonic() - started,
            )
            record.elapsed_ms = int((time.monotonic() - started) * 1000)
            record.finished_at = _iso_now()
            record.updated_at = record.finished_at
            self._store.save_task(record.to_store())
            self._audit(record, "report", "dry_run", "Dry-run report saved. Nothing was executed.")

    # ---------------------------------------------------------------- approvals

    def _request_step_approval(self, record: _Task, step: PlanStep, decision: Any) -> bool | None:
        now = time.monotonic()
        timeout = float(record.settings.approval_timeout_seconds)
        approval = {
            "approval_id": secrets.token_urlsafe(18),
            "step_id": step.id,
            "kind": "domain" if decision.needs_domain_approval else "step",
            "label": decision.label,
            "detail": (
                f"Tier {decision.tier} · {step.goal}"
                + (f" · {decision.reason}" if decision.needs_domain_approval else "")
            ),
            "tier": decision.tier,
            "created_at": _iso_now(),
            "expires_monotonic": now + timeout,
            "expires_at": datetime.fromtimestamp(time.time() + timeout, timezone.utc).isoformat(timespec="seconds"),
            "timeout_seconds": int(timeout),
        }
        with self._lock:
            record.pending_approval = approval
            record.approval_result = None
            record.state = "awaiting_approval"
            record.updated_at = _iso_now()
            self._audit(
                record,
                "approval_requested",
                "pending",
                f"Tier {decision.tier} step '{step.id}' needs approval; expires in {int(timeout)}s.",
                step,
            )
            self._condition.notify_all()
            while record.pending_approval is not None:
                if record.cancel.is_set():
                    record.pending_approval = None
                    return False
                remaining = float(record.pending_approval["expires_monotonic"]) - time.monotonic()
                if remaining <= 0:
                    record.pending_approval = None
                    return None
                self._condition.wait(timeout=min(0.5, remaining))
            result = record.approval_result
            record.approval_result = None
            if result is None:
                return None
            record.state = "running"
            return bool(result)

    # ------------------------------------------------------------------- helpers

    def _handoff(self, record: _Task, message: str) -> None:
        with self._lock:
            if message not in record.notes:
                record.notes.append(message)
            record.handoff = True
            record.paused = True
            record.state = "paused"
            record.updated_at = _iso_now()
            self._audit(record, "handoff", "paused", message)
            self._condition.notify_all()

    def _wait_if_paused(self, record: _Task) -> bool:
        with self._lock:
            while record.paused and not record.cancel.is_set():
                if record.state != "paused":
                    record.state = "paused"
                self._condition.wait(timeout=0.5)
            if record.cancel.is_set():
                return False
            if record.state == "paused":
                record.state = "running"
            return True

    def _scan_observation(self, record: _Task, observation: Observation) -> bool:
        combined = f"{observation.text}\n{observation.hidden_text}"
        report = self.policy.scan_untrusted(combined)
        if not report.detected:
            return False
        if INJECTION_WARNING not in record.injection_warnings:
            record.injection_warnings.append(INJECTION_WARNING)
        self._audit(
            record,
            "injection",
            "ignored",
            f"Prompt-injection pattern detected in untrusted page data; ignored "
            f"({len(report.matches)} match(es)).",
            target=observation.url[:200],
        )
        return True

    def _make_adapter(self, record: _Task) -> ExecutionAdapter:
        if self._adapter_factory is not None:
            return self._adapter_factory(record)
        return BrowserAdapter(
            profile_dir=self._data_dir / "agent-profile",
            screenshots_dir=self._data_dir / "agent-screenshots",
            downloads_dir=self._data_dir / "agent-downloads",
            headed=True,
        )

    def _require(self, task_id: str) -> _Task:
        record = self._tasks.get(task_id)
        if record is None:
            raise AgentNotFound(f"Agent task '{task_id}' was not found in this process.")
        return record

    @staticmethod
    def _step_record(step: PlanStep) -> dict[str, Any]:
        return {
            "id": step.id,
            "goal": step.goal,
            "application": step.application,
            "method": step.method,
            "tier": step.tier,
            "expected_result": step.expected_result,
            "dependencies": list(step.dependencies),
            "action_id": step.action.type,
            "verify": step.verify.to_dict() if step.verify else None,
            "status": "pending",
            "level": "none",
            "detail": "Not started.",
            "injection_warning": False,
            "policy": None,
            "verification": None,
            "started_at": None,
            "finished_at": None,
        }

    def _task_view(self, record: _Task) -> dict[str, Any]:
        elapsed = record.elapsed_ms
        if record.started_monotonic and not record.finished_at:
            elapsed = int((time.monotonic() - record.started_monotonic) * 1000)
        pending = record.pending_approval
        pending_view = None
        if pending:
            pending_view = {
                "approval_id": pending["approval_id"],
                "step_id": pending["step_id"],
                "kind": pending["kind"],
                "label": pending["label"],
                "detail": pending["detail"],
                "tier": pending["tier"],
                "expires_in_ms": max(0, int((float(pending["expires_monotonic"]) - time.monotonic()) * 1000)),
                "expires_at": pending["expires_at"],
            }
        return {
            "id": record.id,
            "task": record.task,
            "state": record.state,
            "dry_run": record.dry_run,
            "plan": record.plan.to_dict() if record.plan else None,
            "steps": list(record.steps),
            "report": record.report,
            "provider": record.provider,
            "model": record.model,
            "planner": record.planner,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "started_at": record.started_at,
            "finished_at": record.finished_at,
            "elapsed_ms": elapsed,
            "current_step_id": record.current_step_id,
            "pending_approval": pending_view,
            "paused": record.paused,
            "handoff": record.handoff,
            "notes": list(record.notes),
            "injection_warnings": list(record.injection_warnings),
            "screenshots_allowed": record.screenshots_allowed,
            "screenshot_provider": record.screenshot_provider,
            "current_application": (
                next(
                    (item["application"] for item in record.steps if item.get("id") == record.current_step_id),
                    None,
                )
                or (record.steps[0]["application"] if record.steps else "Browser")
            ),
        }

    def _report(
        self,
        record: _Task,
        status: str,
        summary: str,
        result_level: str,
        notes: list[str],
        elapsed: float | None = None,
    ) -> dict[str, Any]:
        elapsed_ms = int((elapsed or 0) * 1000)
        if elapsed_ms == 0 and record.started_monotonic:
            elapsed_ms = int((time.monotonic() - record.started_monotonic) * 1000)
        return {
            "status": status,
            "summary": summary,
            "result_level": result_level,
            "verification": {
                "ok": status == "Done",
                "detail": "Only steps with a fresh observation count as verified."
                if status == "Done"
                else summary,
                "source": "browser_dom" if not record.dry_run else "none",
            },
            "steps": [
                {
                    "id": item.get("id"),
                    "status": item.get("status"),
                    "level": item.get("level"),
                    "detail": item.get("detail"),
                    "verification": item.get("verification"),
                }
                for item in record.steps
            ],
            "elapsed_ms": elapsed_ms,
            "steps_executed": sum(1 for item in record.steps if item.get("status") not in ("pending", "skipped")),
            "injections_ignored": len(record.injection_warnings),
            "dry_run": record.dry_run,
            "provider": record.provider,
            "model": record.model,
            "screenshots_shared": False,
            "notes": list(record.notes) + notes,
        }

    def _audit(
        self,
        record: _Task | None,
        event: str,
        outcome: str,
        detail: str,
        step: PlanStep | None = None,
        target: str | None = None,
    ) -> None:
        action_type = step.action.type if step else None
        safe_target = target
        if safe_target is None and step is not None:
            safe_target = str(step.action.params.get("url") or step.action.params.get("name") or step.action.params.get("field") or step.application)
        try:
            self._intent_store.append_audit(
                intent_id=None,
                event=f"agent_{event}",
                action_type=action_type,
                target=(safe_target or "")[:200] or None,
                risk=(self.policy.spec(action_type).risk if action_type and self.policy.spec(action_type) else None),
                outcome=outcome,
                detail=detail[:900],
                created_at=_iso_now(),
            )
        except Exception:  # noqa: BLE001 - audit failure must be logged, not crash a task
            self._logger.exception("agent audit write failed")

    # -------------------------------------------------------------- reliability

    def reliability(self) -> dict[str, Any]:
        view = self.registry.reliability_view()
        view["engine"] = _suite_view(self.registry.latest_result("agent-engine-demo"))
        view["profiles"] = self.registry.profiles_view()
        view["adapters"] = {
            "playwright_installed": BrowserAdapter(
                profile_dir=self._data_dir / "agent-profile",
                screenshots_dir=self._data_dir / "agent-screenshots",
                downloads_dir=self._data_dir / "agent-downloads",
            ).available
        }
        return view

    def run_reliability(self, *, mode: str = "engine", runs: int = 10, task: str | None = None) -> dict[str, Any]:
        runs = max(1, min(int(runs), 10))
        task_text = task or "open the test site, search for A2D, find the newest video, open it, and prepare a comment 'Hurray!'"
        plan = self._planner.plan(task_text, self._settings)
        measurement_settings = AgentSettings(
            **{**self._settings.to_dict(), "approval_mode": "tier2", "domains": self._settings.domains}
        )
        samples: list[dict[str, Any]] = []
        adapter: ExecutionAdapter | None = None
        try:
            if mode == "browser":
                adapter = BrowserAdapter(
                    profile_dir=self._data_dir / "agent-profile",
                    screenshots_dir=self._data_dir / "agent-screenshots",
                    downloads_dir=self._data_dir / "agent-downloads",
                    headed=True,
                )
                if not adapter.available:
                    raise AgentError(
                        "Playwright is not installed. Run: pip install playwright && python -m playwright install chromium"
                    )
                # Reuse one headed browser for the whole measurement run; the
                # loop closes it once every sample has finished.
                adapter.keep_alive = True
                adapter.start()
            for index in range(runs):
                run_adapter = adapter if adapter is not None else SimulatedAdapter()
                started = time.monotonic()
                outcome = self._measure_once(plan, measurement_settings, run_adapter)
                outcome["seconds"] = round(time.monotonic() - started, 3)
                outcome["run"] = index + 1
                samples.append(outcome)
            suite = "browser-playwright" if mode == "browser" else "agent-engine-demo"
            summary = _summarize(samples, suite)
            self.registry.record_result(summary)
            if mode == "browser":
                second = dict(summary)
                second["suite"] = "mock-site-workflow"
                self.registry.record_result(second)
            self._audit(
                None,
                "reliability",
                "measured",
                f"{suite}: {summary['successes']}/{summary['runs']} runs passed; "
                f"avg {summary['avg_steps']} steps, {summary['avg_seconds']}s.",
            )
            return {**summary, "mode": mode, "samples": samples}
        finally:
            if adapter is not None:
                adapter.close()

    def _measure_once(self, plan: AgentPlan, settings: AgentSettings, adapter: ExecutionAdapter) -> dict[str, Any]:
        failures: list[str] = []
        steps = 0
        started = time.monotonic()
        try:
            if not getattr(adapter, "started", False):
                adapter.start()
            observation = adapter.observe()
            self.policy.scan_untrusted(observation.text + observation.hidden_text)
            if observation.consent_banner and hasattr(adapter, "dismiss_consent"):
                adapter.dismiss_consent()
            for step in plan.steps:
                steps += 1
                decision = self.policy.decide(step, settings, adapter.observe())
                if not decision.allowed:
                    failures.append(f"blocked {step.action.type}: {decision.reason}")
                    break
                result = adapter.act(step.action)
                if not result.ok:
                    failures.append(f"{step.id}: {result.detail}")
                    break
                observation = adapter.observe()
                self.policy.scan_untrusted(observation.text + observation.hidden_text)
                if step.verify is not None:
                    ok, detail, evidence = adapter.verify(step.verify)
                    if not ok and step.action.type != "browser.click":
                        time.sleep(0.05)
                        ok, detail, evidence = adapter.verify(step.verify)
                    if not ok:
                        failures.append(f"{step.id} not verified: {detail}")
                        break
                elif step.action.type == "browser.verify" and not result.verified:
                    failures.append(f"{step.id} not verified: {result.detail}")
                    break
            return {
                "passed": not failures,
                "steps": steps,
                "seconds": round(time.monotonic() - started, 3),
                "failures": failures,
            }
        except Exception as exc:  # noqa: BLE001 - measurement must record a real failure
            return {"passed": False, "steps": steps, "seconds": round(time.monotonic() - started, 3), "failures": [str(exc)]}
        finally:
            if adapter is not None and not getattr(adapter, "keep_alive", False):
                try:
                    adapter.close()
                except Exception:  # noqa: BLE001
                    pass

    def _stop_all_locked(self, reason: str) -> None:
        for record in self._tasks.values():
            if record.state in ("done", "failed", "stopped", "cancelled"):
                continue
            record.cancel.set()
            record.paused = False
            record.pending_approval = None
            record.approval_result = False
            record.state = "stopped"
            record.report = self._report(record, "Stopped", reason, "none", [])
            record.updated_at = _iso_now()
            self._audit(record, "stop", "stopped", reason)
        self._active_task_id = None
        self._condition.notify_all()


def _summarize(samples: list[dict[str, Any]], suite: str) -> dict[str, Any]:
    runs = len(samples)
    successes = sum(1 for item in samples if item.get("passed"))
    failures: list[str] = []
    for item in samples:
        if item.get("passed"):
            continue
        reason = "; ".join(item.get("failures") or []) or "unknown failure"
        failures.append(f"run {item.get('run')}: {reason[:240]}")
    avg_steps = round(sum(int(item.get("steps") or 0) for item in samples) / runs, 2) if runs else None
    avg_seconds = round(sum(float(item.get("seconds") or 0) for item in samples) / runs, 3) if runs else None
    return {
        "suite": suite,
        "passed": successes == runs and runs > 0,
        "runs": runs,
        "successes": successes,
        "success_rate": (successes / runs) if runs else None,
        "avg_steps": avg_steps,
        "avg_seconds": avg_seconds,
        "failures": failures[:10],
        "at": _iso_now(),
        "note": (
            "Scripted deterministic plan and simulated page. This measures the policy engine and the "
            "execution loop, not the quality of a real language model."
            if suite == "agent-engine-demo"
            else "Playwright browser run against the local mock site."
        ),
    }


def _suite_view(result: dict[str, Any] | None) -> dict[str, Any]:
    if not result:
        return {"measured": False, "label": "Not measured yet", "runs": None, "successes": None, "success_rate": None, "avg_steps": None, "avg_seconds": None, "failures": [], "at": None}
    runs = int(result.get("runs") or 0)
    successes = int(result.get("successes") or 0)
    return {
        "measured": True,
        "label": "Passed" if result.get("passed") else "Failed",
        "runs": runs,
        "successes": successes,
        "success_rate": (successes / runs) if runs else None,
        "avg_steps": result.get("avg_steps"),
        "avg_seconds": result.get("avg_seconds"),
        "failures": list(result.get("failures") or []),
        "at": result.get("at"),
        "note": result.get("note"),
    }
