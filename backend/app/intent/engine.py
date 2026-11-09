"""Intent workflow engine.

Understand -> Plan -> Approve -> Execute -> Verify -> Report.

The engine is deliberately strict: a plan cannot execute without explicit
confirmation bound to a per-plan challenge, every action is risk-assessed, and
verification re-reads the filesystem. All transitions are appended to the audit
log and the step history.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Callable
import hmac
import json
import logging
import secrets
import uuid

from app.db.store import IntentRecord, IntentStore
from app.intent.parser import EXAMPLE_COMMANDS, ProposedAction, parse_command
from app.intent.stages import (
    APPROVAL_STATES,
    STEPS,
    can_mark_reported,
    report_block_reason,
    required_permissions,
)
from app.modules.registry import MODULE_BY_ID
from app.permissions.policy import assess, highest_risk
from app.tools.workspace import WorkspaceError, WorkspaceTools


class IntentError(Exception):
    """Base class for intent workflow failures."""


class IntentNotFound(IntentError):
    pass


class InvalidStateError(IntentError):
    pass


class ApprovalError(IntentError):
    pass


@dataclass(frozen=True)
class _Plan:
    actions: list[dict[str, Any]]
    warnings: list[str]
    error: str | None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class IntentEngine:
    def __init__(
        self,
        store: IntentStore,
        tools: WorkspaceTools,
        *,
        logger: logging.Logger | None = None,
        clock: Callable[[], str] = _iso_now,
    ):
        self._store = store
        self._tools = tools
        self._logger = logger or logging.getLogger("bozz.intent")
        self._clock = clock

    # ------------------------------------------------------------- public API
    def propose(self, text: str, module: str = "intent-map") -> dict[str, Any]:
        if module not in MODULE_BY_ID:
            raise ValueError(f"Unknown BOZZ module '{module}'.")
        intent_id = uuid.uuid4().hex
        created = self._clock()
        parsed = parse_command(text)

        if not parsed.understood:
            plan = _Plan(actions=[], warnings=[], error=None)
            status = "unrecognized"
            message = parsed.explanation
            approval_id = None
            steps = self._steps(
                understand=("done", parsed.explanation),
                plan=("blocked", "No supported action was recognised."),
                approve=("skipped", "There is no plan to approve."),
                execute=("skipped", "Nothing was executed."),
                verify=("skipped", "Nothing to verify."),
                report=("done", "Nothing was executed."),
            )
        else:
            plan = self._build_plan(parsed.actions)
            if plan.error:
                status = "blocked"
                message = f"I could not safely plan that: {plan.error}"
                approval_id = None
                steps = self._steps(
                    understand=("done", parsed.explanation),
                    plan=("blocked", plan.error),
                    approve=("skipped", "There is no safe plan to approve."),
                    execute=("skipped", "Nothing was executed."),
                    verify=("skipped", "Nothing to verify."),
                    report=("done", "Nothing was executed."),
                )
            else:
                status = "awaiting_approval"
                approval_id = secrets.token_urlsafe(24)
                risk = highest_risk(action["type"] for action in plan.actions)
                message = (
                    f"Plan ready: {len(plan.actions)} action(s), highest risk {risk}. "
                    "Review the preview and approve explicitly."
                )
                steps = self._steps(
                    understand=("done", parsed.explanation),
                    plan=("done", f"{len(plan.actions)} action(s) planned; highest risk {risk}."),
                    approve=("pending", "Waiting for explicit approval."),
                    execute=("pending", "Not started."),
                    verify=("pending", "Not started."),
                    report=("pending", "Not started."),
                )

        plan_payload = {
            "actions": plan.actions,
            "warnings": plan.warnings,
            "examples": list(EXAMPLE_COMMANDS),
            "approval_required": True,
            "module": module,
            "required_permissions": required_permissions(plan.actions),
        }
        record = IntentRecord(
            id=intent_id,
            raw_text=text.strip(),
            status=status,
            plan_json=json.dumps(plan_payload, ensure_ascii=False),
            approval_id=approval_id,
            approval_required=True,
            created_at=created,
            updated_at=created,
        )
        self._store.create_intent(record)
        self._record_steps(intent_id, steps)
        self._store.append_audit(
            intent_id=intent_id,
            event="propose",
            outcome=status,
            detail=f"{len(plan.actions)} action(s); status {status}",
            created_at=created,
        )
        self._logger.info("intent proposed id=%s status=%s actions=%d", intent_id, status, len(plan.actions))
        return self.get(intent_id)

    def approve(self, intent_id: str, approval_id: str, confirm: bool) -> dict[str, Any]:
        record = self._require(intent_id)
        self._require_status(record, "awaiting_approval")
        if not confirm:
            raise ApprovalError("Approval must be explicitly confirmed.")
        expected = record.get("approval_id") or ""
        if not expected or not hmac.compare_digest(str(expected), str(approval_id)):
            raise ApprovalError("The approval challenge does not match this plan.")
        now = self._clock()
        self._store.update_intent(intent_id, "approved", now)
        self._store.append_step(intent_id, "APPROVE", "done", "Approved by the user.", now)
        self._store.append_audit(
            intent_id=intent_id, event="approve", outcome="approved",
            detail="Explicit user approval recorded.", created_at=now,
        )
        self._logger.info("intent approved id=%s", intent_id)
        return self.get(intent_id)

    def reject(self, intent_id: str, reason: str = "") -> dict[str, Any]:
        record = self._require(intent_id)
        self._require_status(record, "awaiting_approval")
        now = self._clock()
        detail = f"Rejected by the user. {reason}".strip()
        self._store.update_intent(intent_id, "rejected", now)
        self._store.append_step(intent_id, "APPROVE", "error", detail, now)
        self._store.append_step(intent_id, "EXECUTE", "skipped", "Nothing was executed.", now)
        self._store.append_step(intent_id, "VERIFY", "skipped", "Nothing to verify.", now)
        self._store.append_step(intent_id, "REPORT", "done", "Request rejected; no action was executed.", now)
        self._store.append_audit(
            intent_id=intent_id, event="reject", outcome="rejected",
            detail=detail, created_at=now,
        )
        self._logger.info("intent rejected id=%s", intent_id)
        return self.get(intent_id)

    def execute(self, intent_id: str) -> dict[str, Any]:
        record = self._require(intent_id)
        self._require_status(record, "approved")
        plan = json.loads(record["plan_json"])
        actions: list[dict[str, Any]] = plan.get("actions", [])
        started = self._clock()
        self._store.append_step(intent_id, "EXECUTE", "running", f"Running {len(actions)} action(s).", started)

        outcomes: list[dict[str, Any]] = []
        results: dict[int, dict[str, Any]] = {}
        failure: tuple[int, dict[str, Any], str] | None = None
        for index, action in enumerate(actions, start=1):
            try:
                result = self._dispatch(action)
            except (WorkspaceError, OSError) as exc:
                failure = (index, action, str(exc))
                outcomes.append({"index": index, "type": action["type"], "target": action["target"], "ok": False, "detail": str(exc)})
                self._store.append_audit(
                    intent_id=intent_id, event="execute", action_type=action["type"],
                    target=action["target"], risk=action.get("risk"), outcome="error",
                    detail=str(exc), created_at=self._clock(),
                )
                break
            except Exception as exc:  # boundary: never leave a half-run workflow unreported
                self._logger.exception("unexpected tool failure id=%s action=%s", intent_id, action.get("type"))
                failure = (index, action, f"Unexpected tool failure: {exc}")
                outcomes.append({"index": index, "type": action["type"], "target": action["target"], "ok": False, "detail": str(exc)})
                break
            results[index] = result
            outcomes.append({
                "index": index,
                "type": action["type"],
                "target": action["target"],
                "ok": True,
                "detail": self._summarize_result(action["type"], result),
            })
            self._store.append_audit(
                intent_id=intent_id, event="execute", action_type=action["type"],
                target=action["target"], risk=action.get("risk"), outcome="ok",
                detail=self._summarize_result(action["type"], result), created_at=self._clock(),
            )

        if failure:
            index, action, error = failure
            self._store.append_step(
                intent_id, "EXECUTE", "error",
                f"Stopped at action {index} ({action['type']}): {error}", self._clock(),
            )
            self._store.append_step(intent_id, "VERIFY", "skipped", "Not reached because execution stopped.", self._clock())
            summary = f"Stopped at action {index} of {len(actions)}: {error} No further actions were run."
            report = self._report(summary, outcomes, [])
            self._finish(intent_id, "failed", report, "error", summary)
            return self.get(intent_id)

        self._store.append_step(intent_id, "EXECUTE", "done", f"Executed {len(outcomes)} action(s).", self._clock())

        verifications: list[dict[str, Any]] = []
        for index, action in enumerate(actions, start=1):
            matching = next((item for item in outcomes if item["index"] == index), None)
            if matching is None:
                continue
            ok, detail = self._tools.verify(action, results[index])
            verifications.append(
                {"action": index, "ok": ok, "detail": detail, "source": "filesystem"}
            )
            self._store.append_audit(
                intent_id=intent_id, event="verify", action_type=action["type"],
                target=action["target"], risk=action.get("risk"),
                outcome="ok" if ok else "error", detail=detail, created_at=self._clock(),
            )

        failed = [item for item in verifications if not item["ok"]]
        if failed:
            detail = f"{len(failed)} of {len(verifications)} verification check(s) failed."
            self._store.append_step(intent_id, "VERIFY", "error", detail, self._clock())
            summary = f"Executed {len(outcomes)} action(s), but {detail} Review the report before relying on the result."
            report = self._report(summary, outcomes, verifications)
            self._finish(intent_id, "failed", report, "error", summary)
        else:
            detail = f"All {len(verifications)} verification check(s) passed."
            self._store.append_step(intent_id, "VERIFY", "done", detail, self._clock())
            summary = f"Completed {len(outcomes)} action(s) and verified all results."
            report = self._report(summary, outcomes, verifications)
            self._finish(intent_id, "reported", report, "done", summary)

        self._logger.info("intent executed id=%s actions=%d status=%s", intent_id, len(outcomes), self._require(intent_id)["status"])
        return self.get(intent_id)

    def get(self, intent_id: str) -> dict[str, Any]:
        record = self._require(intent_id)
        return self._view(record)

    def list(self, limit: int = 20) -> list[dict[str, Any]]:
        return self._store.list_intents(limit)

    def audit(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._store.list_audit(limit)

    def workspace_summary(self) -> dict[str, Any]:
        return {
            "name": self._tools.root.name,
            "path_hint": f"data/{self._tools.root.name}",
            "stats": self._tools.stats(),
        }

    # -------------------------------------------------------------- planning
    def _build_plan(self, proposed: tuple[ProposedAction, ...]) -> _Plan:
        actions: list[dict[str, Any]] = []
        warnings: list[str] = []
        for item in proposed:
            try:
                action, action_warnings = self._validate(item)
            except WorkspaceError as exc:
                return _Plan(actions=[], warnings=warnings, error=str(exc))
            actions.append(action)
            warnings.extend(action_warnings)
        return _Plan(actions=actions, warnings=warnings, error=None)

    def _validate(self, item: ProposedAction) -> tuple[dict[str, Any], list[str]]:
        warnings: list[str] = []
        payload = dict(item.payload)
        target = item.target

        if item.type == "workspace.stats":
            target = "."
        elif item.type == "workspace.move":
            destination = str(payload.get("destination", ""))
            src_info = self._tools.inspect(target, allow_root=False)
            dst_info = self._tools.inspect(destination, allow_root=False)
            if not src_info.exists:
                raise WorkspaceError(f"'{target}' does not exist in the workspace.")
            if dst_info.exists and src_info.path.lower() != dst_info.path.lower():
                raise WorkspaceError(f"'{destination}' already exists; choose a new destination.")
            if src_info.kind == "symlink" or dst_info.kind == "symlink":
                raise WorkspaceError("Symbolic links are not supported in the workspace.")
            source_parts = PurePosixPath(src_info.path).parts
            destination_parts = PurePosixPath(dst_info.path).parts
            if destination_parts[: len(source_parts)] == source_parts:
                raise WorkspaceError("A folder cannot be moved inside itself.")
            target = src_info.path
            payload["destination"] = dst_info.path
            parent = self._parent_of(dst_info.path)
            if parent and not self._tools.inspect(parent, allow_root=True).exists:
                warnings.append(f"Folder '{parent}' will be created for the destination.")
        else:
            info = self._tools.inspect(target, allow_root=item.type in ("workspace.list", "workspace.search"))
            if item.type == "workspace.list" and info.kind != "dir":
                raise WorkspaceError(f"'{target}' is not a folder.")
            if item.type == "workspace.read" and info.kind != "file":
                raise WorkspaceError(f"'{target}' is not a readable file.")
            if item.type == "workspace.search":
                if not str(payload.get("query", "")).strip():
                    raise WorkspaceError("A search query is required.")
                if info.kind not in ("file", "dir"):
                    raise WorkspaceError(f"'{target}' does not exist in the workspace.")
            if item.type == "workspace.mkdir":
                if info.exists and info.kind != "dir":
                    raise WorkspaceError(f"'{target}' already exists as a file.")
                if info.exists:
                    warnings.append(f"Folder '{target}' already exists; nothing will change.")
            if item.type in ("workspace.write", "workspace.append"):
                if item.type == "workspace.write":
                    overwrite = bool(payload.get("overwrite", False))
                    if info.exists and info.kind != "file":
                        raise WorkspaceError(f"'{target}' is a folder, not a file.")
                    if info.exists and not overwrite:
                        raise WorkspaceError(
                            f"'{target}' already exists. Use an overwrite command to replace it."
                        )
                    if info.exists and overwrite:
                        warnings.append("The existing file content will be replaced; a backup is kept in .trash.")
                else:
                    if info.exists and info.kind != "file":
                        raise WorkspaceError(f"'{target}' is a folder, not a file.")
                parent = self._parent_of(info.path)
                if parent:
                    parent_info = self._tools.inspect(parent, allow_root=True)
                    if parent_info.exists and parent_info.kind != "dir":
                        raise WorkspaceError(f"'{parent}' is not a folder.")
                    if not parent_info.exists:
                        warnings.append(f"Folder '{parent}' will be created.")
            if item.type == "workspace.delete":
                if not info.exists:
                    raise WorkspaceError(f"'{target}' does not exist in the workspace.")
                warnings.append("The item is moved to the workspace .trash folder, not permanently erased.")
            target = info.path

        assessment = assess(item.type)
        return (
            {
                "type": item.type,
                "target": target,
                "payload": payload,
                "description": item.description,
                "preview": item.preview,
                "risk": assessment.risk,
                "reversible": assessment.reversible,
            },
            warnings,
        )

    def _parent_of(self, target: str) -> str:
        parent = str(PurePosixPath(target).parent)
        return "" if parent in ("", ".", "/") else parent

    # ------------------------------------------------------------- execution
    def _dispatch(self, action: dict[str, Any]) -> dict[str, Any]:
        action_type = action["type"]
        target = action["target"]
        payload = action.get("payload", {})
        if action_type == "workspace.list":
            return self._tools.list_dir(target)
        if action_type == "workspace.read":
            return self._tools.read_file(target)
        if action_type == "workspace.search":
            return self._tools.search(str(payload.get("query", "")), target)
        if action_type == "workspace.stats":
            return self._tools.stats()
        if action_type == "workspace.mkdir":
            return self._tools.make_dir(target)
        if action_type == "workspace.write":
            return self._tools.write_file(target, str(payload.get("content", "")), overwrite=bool(payload.get("overwrite", False)))
        if action_type == "workspace.append":
            return self._tools.append_file(target, str(payload.get("content", "")))
        if action_type == "workspace.move":
            return self._tools.move_path(target, str(payload.get("destination", "")))
        if action_type == "workspace.delete":
            return self._tools.delete_path(target)
        raise WorkspaceError(f"Unsupported action type '{action_type}'.")

    def _summarize_result(self, action_type: str, result: dict[str, Any]) -> str:
        if action_type == "workspace.list":
            return f"{result.get('count', 0)} entries in '{result.get('path')}'."
        if action_type == "workspace.read":
            return f"Read {result.get('bytes', 0)} bytes from '{result.get('path')}'."
        if action_type == "workspace.write":
            state = "overwritten" if result.get("overwritten") else "created"
            return f"{state.capitalize()} '{result.get('path')}' ({result.get('bytes_written', 0)} bytes)."
        if action_type == "workspace.append":
            return f"Appended {result.get('bytes_appended', 0)} bytes to '{result.get('path')}'."
        if action_type == "workspace.mkdir":
            return f"Folder '{result.get('path')}' is ready."
        if action_type == "workspace.move":
            return f"Moved '{result.get('from')}' to '{result.get('to')}'."
        if action_type == "workspace.delete":
            return f"Moved '{result.get('path')}' to {result.get('trash_path')}."
        if action_type == "workspace.search":
            return f"{result.get('count', 0)} match(es) across {result.get('scanned_files', 0)} file(s)."
        if action_type == "workspace.stats":
            return f"{result.get('files', 0)} files, {result.get('folders', 0)} folders, {result.get('bytes', 0)} bytes."
        return "Completed."

    # -------------------------------------------------------------- reporting
    def _report(self, summary: str, outcomes: list[dict[str, Any]], verifications: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "summary": summary,
            "actions": outcomes,
            "verification": verifications,
            "finished_at": self._clock(),
        }

    def _finish(
        self,
        intent_id: str,
        status: str,
        report: dict[str, Any],
        step_status: str,
        summary: str,
    ) -> None:
        now = self._clock()
        steps = self._latest_steps(intent_id)
        if status == "reported" and not can_mark_reported(steps, report):
            reason = report_block_reason(steps, report) or "Verification evidence is missing."
            status = "failed"
            step_status = "error"
            summary = f"Task not marked done. {reason} {summary}"
            report = {**report, "summary": summary, "done_allowed": False, "blocked_reason": reason}
            self._logger.error("reported status blocked id=%s reason=%s", intent_id, reason)
        else:
            report = {**report, "done_allowed": status == "reported"}
        self._store.append_step(intent_id, "REPORT", step_status, summary, now)
        self._store.update_intent(intent_id, status, now, json.dumps(report, ensure_ascii=False))
        self._store.append_audit(
            intent_id=intent_id, event="report", outcome=status,
            detail=summary, created_at=now,
        )

    def _latest_steps(self, intent_id: str) -> list[dict[str, Any]]:
        latest: dict[str, dict[str, Any]] = {}
        for row in self._store.list_steps(intent_id):
            latest[row["step"]] = {
                "step": row["step"],
                "status": row["status"],
                "detail": row["detail"],
                "at": row["created_at"],
            }
        return [
            latest.get(step, {"step": step, "status": "pending", "detail": "Not started.", "at": None})
            for step in STEPS
        ]

    # ---------------------------------------------------------------- helpers
    def _steps(self, **details: tuple[str, str]) -> dict[str, tuple[str, str]]:
        return {key.upper(): value for key, value in details.items()}

    def _record_steps(self, intent_id: str, steps: dict[str, tuple[str, str]]) -> None:
        now = self._clock()
        for step in STEPS:
            status, detail = steps[step]
            self._store.append_step(intent_id, step, status, detail, now)

    def _require(self, intent_id: str) -> dict[str, Any]:
        record = self._store.get_intent(intent_id)
        if record is None:
            raise IntentNotFound(f"Intent '{intent_id}' was not found.")
        return record

    def _require_status(self, record: dict[str, Any], expected: str) -> None:
        if record["status"] != expected:
            raise InvalidStateError(
                f"Intent is '{record['status']}', but this operation requires '{expected}'."
            )

    def _view(self, record: dict[str, Any]) -> dict[str, Any]:
        plan = json.loads(record["plan_json"])
        report = json.loads(record["report_json"]) if record.get("report_json") else None
        steps = self._latest_steps(record["id"])
        public_actions = [
            {key: value for key, value in action.items() if key != "payload"}
            for action in plan.get("actions", [])
        ]
        permissions = plan.get("required_permissions")
        if not isinstance(permissions, list):
            permissions = required_permissions(plan.get("actions", []))
        evidence = report.get("verification", []) if report else []
        evidence = [dict(item) for item in evidence] if isinstance(evidence, list) else []
        errors = [
            {"stage": step["step"], "detail": step["detail"]}
            for step in steps
            if step["status"] in ("error", "blocked") and str(step["detail"]).strip()
        ]
        approval_state = APPROVAL_STATES.get(record["status"], "not_requested")
        done_allowed = record["status"] == "reported" and can_mark_reported(steps, report)
        task = {
            "id": record["id"],
            "module": plan.get("module", "intent-map"),
            "stages": steps,
            "required_permissions": permissions,
            "approval_state": approval_state,
            "errors": errors,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
        }
        return {
            "id": record["id"],
            "text": record["raw_text"],
            "status": record["status"],
            "understood": record["status"] not in ("unrecognized", "blocked"),
            "approval_required": bool(record["approval_required"]),
            "approval_id": record["approval_id"],
            "module": plan.get("module", "intent-map"),
            "required_permissions": permissions,
            "approval_state": approval_state,
            "errors": errors,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
            "task": task,
            "message": self._message(record["status"], steps, report),
            "warnings": plan.get("warnings", []),
            "examples": plan.get("examples", []),
            "actions": public_actions,
            "steps": steps,
            "report": report,
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }

    def _message(self, status: str, steps: list[dict[str, Any]], report: dict[str, Any] | None) -> str:
        by_step = {step["step"]: step for step in steps}
        if status == "awaiting_approval":
            return by_step["PLAN"]["detail"] + " Review and approve explicitly."
        if status == "approved":
            return "Approved. Execution has not started yet."
        if status == "rejected":
            return "Rejected. No action was executed."
        if status == "unrecognized":
            return by_step["UNDERSTAND"]["detail"]
        if status == "blocked":
            return by_step["PLAN"]["detail"]
        if report:
            return str(report.get("summary", "Finished."))
        return status
