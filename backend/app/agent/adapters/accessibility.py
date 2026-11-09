"""Windows UI Automation adapter — documented stub for a later milestone.

A real implementation (Milestone 2 roadmap) must:
- use Windows UI Automation / the accessibility tree, not pixel guessing;
- identify controls by role and accessible name;
- work only with the foreground window chosen by the user;
- refuse Tier 3 actions before calling the OS;
- return a fresh accessibility observation for verification;
- stop safely when the control tree is ambiguous.

Milestone 1 implements no UIA code. ``available`` is always False.
"""

from __future__ import annotations

from typing import Any

from app.agent.adapters.base import AdapterUnavailable
from app.agent.schemas import ActionResult, AgentAction, Observation, VerificationCheck


class AccessibilityAdapter:
    name = "Windows UI Automation"
    method = "accessibility"

    @property
    def available(self) -> bool:
        return False

    def start(self) -> None:
        raise AdapterUnavailable("Windows UI Automation is planned for a later milestone and is not installed.")

    def inspect(self) -> Observation:
        raise AdapterUnavailable("Windows UI Automation is planned for a later milestone and is not installed.")

    def act(self, action: AgentAction) -> ActionResult:
        raise AdapterUnavailable("Windows UI Automation is planned for a later milestone and is not installed.")

    def observe(self) -> Observation:
        raise AdapterUnavailable("Windows UI Automation is planned for a later milestone and is not installed.")

    def verify(self, check: VerificationCheck) -> tuple[bool, str, dict[str, Any] | None]:
        raise AdapterUnavailable("Windows UI Automation is planned for a later milestone and is not installed.")

    def close(self) -> None:
        return None
