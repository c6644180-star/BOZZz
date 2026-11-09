"""Thin proxy to the existing Desktop Control v2 controller.

This adapter does not open a shell, press arbitrary keys or invent mouse
coordinates. It can only forward an action id that already exists in
``config/desktop_actions.json`` and is Tier 1, and only while Desktop Control
is already enabled and permitted. Tier 2 app launches stay in the existing
Desktop Control panel with its own approval queue; the agent does not claim
them in Milestone 1.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.agent.adapters.base import AdapterError, AdapterUnavailable
from app.agent.schemas import ActionResult, AgentAction, Observation, VerificationCheck


class _Controller(Protocol):
    enabled: bool
    emergency_stopped: bool

    def process_action(self, action_id: str, params: dict[str, Any] | None = None, *, source: str = "gesture", confidence: float | None = None) -> dict[str, Any]: ...

    def status(self) -> dict[str, Any]: ...


class DesktopAdapter:
    name = "BOZZ Desktop Control"
    method = "desktop"

    def __init__(self, controller: _Controller | None):
        self.controller = controller

    @property
    def available(self) -> bool:
        return bool(self.controller and self.controller.enabled and not self.controller.emergency_stopped)

    def start(self) -> None:
        if not self.available:
            raise AdapterUnavailable(
                "Desktop Control is off. The agent will not turn it on. Use the Desktop Control panel first."
            )

    def inspect(self) -> Observation:
        if not self.available:
            raise AdapterUnavailable("Desktop Control is off.")
        status = self.controller.status()  # type: ignore[union-attr]
        state = str(status.get("state") or "Off")
        return Observation(
            application="Desktop",
            url="",
            title=f"Desktop Control: {state}",
            text=f"Desktop Control state: {state}",
            elements=[],
        )

    def act(self, action: AgentAction) -> ActionResult:
        if not self.available:
            return ActionResult(action.type, "attempted", False, "Desktop Control is off; the agent did not turn it on.")
        if action.type != "app.launch":
            return ActionResult(
                action.type,
                "none",
                False,
                "Only an allowlisted app launch is exposed to the agent through Desktop Control in this milestone.",
            )
        result = self.controller.process_action(  # type: ignore[union-attr]
            "app.launch",
            dict(action.params),
            source="agent",
        )
        if result.get("approval"):
            return ActionResult(
                action.type,
                "attempted",
                False,
                "Desktop Control queued its own approval for this app launch. Approve it in the Desktop Control panel.",
            )
        ok = bool(result.get("accepted")) and result.get("status") == "verified"
        return ActionResult(
            action.type,
            "verified" if ok else "completed",
            bool(result.get("accepted")),
            str(result.get("message") or "Desktop Control returned no detail."),
            self.method,
            verified=ok,
        )

    def observe(self) -> Observation:
        return self.inspect()

    def verify(self, check: VerificationCheck) -> tuple[bool, str, dict[str, Any] | None]:
        if check.check == "title_contains":
            status = self.controller.status() if self.controller else {}
            state = str(status.get("state") or "")
            ok = check.value.casefold() in state.casefold()
            return ok, f"Desktop Control state {state!r}; expected {check.value!r}.", {"source": "desktop_state"}
        return False, "The desktop proxy can only verify its own state in this milestone.", None

    def close(self) -> None:
        return None
