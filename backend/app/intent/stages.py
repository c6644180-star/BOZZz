"""Intent Map stage rules.

The critical rule: EXECUTE is not VERIFY. A task may only be reported ``done``
after the VERIFY stage recorded real evidence from the tool that performed the
action. A command, request, or model statement is never evidence.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

STEPS: tuple[str, ...] = ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT")

# Sources produced by an independent post-action check. A frontend viewer state
# is acceptable only for the local L3DME task, never for a backend file change.
# Local rules are the deterministic checker used by BCI unanswered/attention.
EVIDENCE_SOURCES = frozenset(
    {"filesystem", "viewer_state", "model_response", "local_rules", "desktop_state"}
)

ACTION_PERMISSIONS: Mapping[str, str] = {
    "workspace.list": "file_access",
    "workspace.read": "file_access",
    "workspace.search": "file_access",
    "workspace.stats": "file_access",
    "workspace.mkdir": "file_access",
    "workspace.write": "file_access",
    "workspace.append": "file_access",
    "workspace.move": "file_access",
    "workspace.delete": "file_access",
    "spatial.open": "file_access",
    "bci.summarise": "message_data",
    "bci.unanswered": "message_data",
    "bci.attention": "message_data",
    "bci.draft": "message_data",
    "bci.rewrite": "message_data",
    "bci.translate": "message_data",
    "desktop.action": "device_control",
}

APPROVAL_STATES: Mapping[str, str] = {
    "awaiting_approval": "pending",
    "approved": "approved",
    "reported": "approved",
    "rejected": "rejected",
    "unrecognized": "not_requested",
    "blocked": "not_requested",
    "failed": "approved",
}


def required_permissions(actions: Iterable[Mapping[str, Any]]) -> list[str]:
    required = {
        ACTION_PERMISSIONS[action["type"]]
        for action in actions
        if action.get("type") in ACTION_PERMISSIONS
    }
    return sorted(required)


def latest_stage_status(steps: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for step in steps:
        statuses[str(step.get("step"))] = str(step.get("status", "pending"))
    return statuses


def verification_evidence(report: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    if not report:
        return []
    evidence = report.get("verification")
    return [dict(item) for item in evidence] if isinstance(evidence, list) else []


def has_verification_evidence(report: Mapping[str, Any] | None) -> bool:
    evidence = verification_evidence(report)
    if not evidence:
        return False
    for item in evidence:
        if item.get("ok") is not True:
            return False
        if not str(item.get("detail", "")).strip():
            return False
        if item.get("source") not in EVIDENCE_SOURCES:
            return False
    return True


def report_block_reason(
    steps: Iterable[Mapping[str, Any]], report: Mapping[str, Any] | None
) -> str | None:
    statuses = latest_stage_status(steps)
    if statuses.get("VERIFY") != "done":
        return "VERIFY has not completed with a passing result."
    if not has_verification_evidence(report):
        return "VERIFY has no real evidence. A command or request is not evidence."
    return None


def can_mark_reported(
    steps: Iterable[Mapping[str, Any]], report: Mapping[str, Any] | None
) -> bool:
    return report_block_reason(steps, report) is None
