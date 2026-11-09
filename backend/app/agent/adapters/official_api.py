"""Official API adapter — documented stub for a later milestone.

Contract (same as every adapter): inspect(), act(), observe(), verify().

A real implementation must:
- use an application's documented, authenticated API instead of the screen;
- keep credentials in the backend process and never in the frontend;
- map every API call to an agent action id and a tier from
  ``config/computer_agent.json`` before calling it;
- return an observation that can be independently verified;
- refuse blocked actions before any network call.

Milestone 1 implements no provider. ``available`` is always False, so the
method selector never claims an API path exists.
"""

from __future__ import annotations

from typing import Any

from app.agent.adapters.base import AdapterUnavailable
from app.agent.schemas import ActionResult, AgentAction, Observation, VerificationCheck


class OfficialApiAdapter:
    name = "Official API"
    method = "api"

    @property
    def available(self) -> bool:
        return False

    def start(self) -> None:
        raise AdapterUnavailable("No official API adapter is implemented in this milestone.")

    def inspect(self) -> Observation:
        raise AdapterUnavailable("No official API adapter is implemented in this milestone.")

    def act(self, action: AgentAction) -> ActionResult:
        raise AdapterUnavailable("No official API adapter is implemented in this milestone.")

    def observe(self) -> Observation:
        raise AdapterUnavailable("No official API adapter is implemented in this milestone.")

    def verify(self, check: VerificationCheck) -> tuple[bool, str, dict[str, Any] | None]:
        raise AdapterUnavailable("No official API adapter is implemented in this milestone.")

    def close(self) -> None:
        return None
