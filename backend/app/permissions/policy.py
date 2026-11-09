"""Risk policy for proposed actions.

Approval is always required for actions in this milestone, including reads.
Auto-approval can be introduced later, but only after the audit trail and tests
cover it. Raw model, voice, or gesture text can never bypass this policy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Mapping

Risk = Literal["low", "medium", "high"]

_RISK: Mapping[str, Risk] = {
    "workspace.list": "low",
    "workspace.read": "low",
    "workspace.search": "low",
    "workspace.stats": "low",
    "workspace.mkdir": "low",
    "workspace.write": "medium",
    "workspace.append": "medium",
    "workspace.move": "medium",
    "workspace.delete": "high",
}

_REVERSIBLE: Mapping[str, bool] = {
    "workspace.list": True,
    "workspace.read": True,
    "workspace.search": True,
    "workspace.stats": True,
    "workspace.mkdir": True,
    "workspace.write": True,   # overwritten content is backed up under .trash
    "workspace.append": False,  # BOZZ cannot automatically undo an append
    "workspace.move": True,     # can be moved back
    "workspace.delete": True,   # moved to .trash, not erased
}


@dataclass(frozen=True)
class Assessment:
    risk: Risk
    reversible: bool
    requires_approval: bool


def assess(action_type: str) -> Assessment:
    try:
        risk = _RISK[action_type]
        reversible = _REVERSIBLE[action_type]
    except KeyError as exc:
        raise ValueError(f"No permission policy exists for action '{action_type}'.") from exc
    return Assessment(risk=risk, reversible=reversible, requires_approval=True)


def approval_required(action_types: Iterable[str]) -> bool:
    return any(assess(action_type).requires_approval for action_type in action_types)


def highest_risk(action_types: Iterable[str]) -> Risk:
    order: dict[Risk, int] = {"low": 0, "medium": 1, "high": 2}
    risk: Risk = "low"
    for action_type in action_types:
        candidate = assess(action_type).risk
        if order[candidate] > order[risk]:
            risk = candidate
    return risk
