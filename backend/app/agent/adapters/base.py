"""Common typed contract for every computer-operation method.

Preference order: official API, accessibility/DOM, vision, raw mouse/keyboard.
Milestone 1 implements BrowserAdapter (DOM/accessibility) and a thin Desktop
adapter that can only reuse the existing Desktop Control controller. The API
and Windows UI Automation adapters are documented stubs and report themselves
as unavailable instead of pretending to work.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.agent.schemas import ActionResult, AgentAction, Observation, VerificationCheck


class AdapterError(RuntimeError):
    """A method could not inspect, act on or verify the application state."""


class AdapterUnavailable(AdapterError):
    """The method is not installed or not permitted on this machine."""


@runtime_checkable
class ExecutionAdapter(Protocol):
    name: str
    method: str

    @property
    def available(self) -> bool: ...

    def start(self) -> None: ...

    def inspect(self) -> Observation: ...

    def act(self, action: AgentAction) -> ActionResult: ...

    def observe(self) -> Observation: ...

    def verify(self, check: VerificationCheck) -> tuple[bool, str, dict[str, Any] | None]: ...

    def close(self) -> None: ...
