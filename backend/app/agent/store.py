"""Persistence for computer-agent tasks and step results.

Screenshots, page bodies and typed secrets are never written here. Step detail
is the short human-readable result from the executor.
"""

from __future__ import annotations

from typing import Any
import json

from app.db.database import Database


class AgentIdempotencyConflict(ValueError):
    """A client idempotency key was reused with a different request payload."""


class AgentStore:
    def __init__(self, database: Database):
        self._db = database
        self._db.initialize()

    def save_task(self, task: dict[str, Any]) -> None:
        now = str(task.get("updated_at") or task.get("created_at") or "")
        plan = task.get("plan")
        report = task.get("report")
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO agent_tasks (
                    id, task, state, dry_run, plan_json, report_json,
                    provider, model, planner, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    task = excluded.task,
                    state = excluded.state,
                    dry_run = excluded.dry_run,
                    plan_json = excluded.plan_json,
                    report_json = excluded.report_json,
                    provider = excluded.provider,
                    model = excluded.model,
                    planner = excluded.planner,
                    updated_at = excluded.updated_at
                """,
                (
                    task["id"],
                    task["task"],
                    task["state"],
                    int(bool(task.get("dry_run"))),
                    json.dumps(plan, ensure_ascii=False) if plan else None,
                    json.dumps(report, ensure_ascii=False) if report else None,
                    task.get("provider"),
                    task.get("model"),
                    task.get("planner"),
                    task.get("created_at") or now,
                    now,
                ),
            )
            connection.execute("DELETE FROM agent_steps WHERE task_id = ?", (task["id"],))
            for step in task.get("steps") or []:
                connection.execute(
                    """
                    INSERT INTO agent_steps (task_id, step_id, status, level, detail, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        task["id"],
                        str(step.get("id") or ""),
                        str(step.get("status") or "pending"),
                        str(step.get("level") or "none"),
                        str(step.get("detail") or "")[:1000],
                        now,
                    ),
                )

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT * FROM agent_tasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                return None
            steps = connection.execute(
                "SELECT step_id, status, level, detail, updated_at FROM agent_steps WHERE task_id = ? ORDER BY id",
                (task_id,),
            ).fetchall()
        payload = dict(row)
        payload["plan"] = json.loads(payload.pop("plan_json")) if payload.get("plan_json") else None
        payload["report"] = json.loads(payload.pop("report_json")) if payload.get("report_json") else None
        payload["dry_run"] = bool(payload.get("dry_run"))
        step_state = {str(item["step_id"]): dict(item) for item in steps}
        plan_steps = (payload["plan"] or {}).get("steps") or []
        payload["steps"] = []
        for plan_step in plan_steps:
            step_id = str(plan_step.get("id") or "")
            saved = step_state.get(step_id, {})
            action = plan_step.get("action") or {}
            payload["steps"].append({
                "id": step_id,
                "goal": str(plan_step.get("goal") or ""),
                "application": str(plan_step.get("application") or ""),
                "method": str(plan_step.get("method") or ""),
                "tier": int(plan_step.get("tier") or 0),
                "expected_result": str(plan_step.get("expected_result") or ""),
                "dependencies": list(plan_step.get("dependencies") or []),
                "action_id": str(action.get("type") or ""),
                "verify": plan_step.get("verify"),
                "status": str(saved.get("status") or "pending"),
                "level": str(saved.get("level") or "none"),
                "detail": str(saved.get("detail") or "Not started."),
                "injection_warning": False,
                "policy": None,
                "verification": None,
                "started_at": None,
                "finished_at": None,
            })
        return payload


    def get_idempotency(self, idempotency_key: str, request_hash: str) -> str | None:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT request_hash, task_id FROM agent_idempotency WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
        if row is None:
            return None
        if row["request_hash"] != request_hash:
            raise AgentIdempotencyConflict(
                "This idempotency key was already used for a different task request."
            )
        return str(row["task_id"])

    def reserve_task(
        self,
        *,
        idempotency_key: str,
        request_hash: str,
        task_id: str,
        task: str,
        dry_run: bool,
        provider: str | None,
        model: str | None,
        created_at: str,
    ) -> tuple[str, bool]:
        """Atomically reserve a logical task request before planning begins."""
        with self._db.transaction() as connection:
            existing = connection.execute(
                "SELECT request_hash, task_id FROM agent_idempotency WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != request_hash:
                    raise AgentIdempotencyConflict(
                        "This idempotency key was already used for a different task request."
                    )
                return str(existing["task_id"]), False
            connection.execute(
                """
                INSERT INTO agent_tasks (
                    id, task, state, dry_run, plan_json, report_json,
                    provider, model, planner, created_at, updated_at
                ) VALUES (?, ?, 'planning', ?, NULL, NULL, ?, ?, NULL, ?, ?)
                """,
                (task_id, task, int(dry_run), provider, model, created_at, created_at),
            )
            connection.execute(
                """
                INSERT INTO agent_idempotency (
                    idempotency_key, request_hash, task_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (idempotency_key, request_hash, task_id, created_at, created_at),
            )
        return task_id, True

    def recover_interrupted_tasks(self, updated_at: str) -> int:
        """Fail closed after a process restart; never replay uncertain external actions."""
        terminal = ("done", "failed", "stopped", "cancelled")
        placeholders = ",".join("?" for _ in terminal)
        with self._db.transaction() as connection:
            rows = connection.execute(
                f"SELECT id, task, dry_run, provider, model FROM agent_tasks WHERE state NOT IN ({placeholders})",
                terminal,
            ).fetchall()
            for row in rows:
                task_id = str(row["id"])
                step_rows = connection.execute(
                    "SELECT step_id, status, level, detail FROM agent_steps WHERE task_id = ? ORDER BY id",
                    (task_id,),
                ).fetchall()
                steps = []
                for step in step_rows:
                    status = str(step["status"])
                    if status not in ("verified", "blocked", "failed", "cancelled", "skipped"):
                        status = "interrupted"
                    steps.append({
                        "id": str(step["step_id"]),
                        "status": status,
                        "level": "unknown" if status == "interrupted" else str(step["level"]),
                        "detail": (
                            "Backend restarted before this step reached a durable final result. "
                            "BOZZ did not retry it; inspect the target application before taking further action."
                            if status == "interrupted" else str(step["detail"])
                        ),
                        "verification": None,
                    })
                summary = (
                    "BOZZ restarted while this task was unfinished. The task was not resumed or retried "
                    "because the outcome of an in-flight external action may be unknown. Inspect the target "
                    "application before manually starting a new task."
                )
                report = {
                    "status": "Interrupted",
                    "summary": summary,
                    "result_level": "unknown",
                    "verification": {"ok": False, "detail": summary, "source": "none"},
                    "steps": steps,
                    "elapsed_ms": 0,
                    "steps_executed": sum(1 for step in steps if step["status"] != "interrupted"),
                    "injections_ignored": 0,
                    "dry_run": bool(row["dry_run"]),
                    "provider": row["provider"] or "unknown",
                    "model": row["model"] or "unknown",
                    "screenshots_shared": False,
                    "notes": ["Automatic recovery is disabled to prevent duplicate external actions."],
                }
                connection.execute(
                    """
                    UPDATE agent_tasks
                    SET state = 'failed', report_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (json.dumps(report, ensure_ascii=False), updated_at, task_id),
                )
                connection.execute(
                    """
                    UPDATE agent_steps
                    SET status = 'interrupted', level = 'unknown',
                        detail = ?, updated_at = ?
                    WHERE task_id = ?
                      AND status NOT IN ('verified', 'blocked', 'failed', 'cancelled', 'skipped')
                    """,
                    (
                        "Backend restarted before a durable final result. Not retried; inspect the target app.",
                        updated_at,
                        task_id,
                    ),
                )
                connection.execute(
                    """
                    UPDATE agent_action_journal
                    SET state = 'unknown',
                        result_json = ?,
                        finished_at = ?
                    WHERE task_id = ? AND state = 'started'
                    """,
                    (
                        json.dumps({
                            "status": "unknown",
                            "detail": "Backend restarted while the adapter action was in flight. It may have completed; BOZZ did not replay it.",
                        }, ensure_ascii=False),
                        updated_at,
                        task_id,
                    ),
                )
        return len(rows)



    def begin_action(
        self,
        *,
        task_id: str,
        step_id: str,
        attempt: int,
        action_type: str,
        action_fingerprint: str,
        started_at: str,
    ) -> int:
        """Durably record an adapter action before any external side effect."""
        with self._db.transaction() as connection:
            existing = connection.execute(
                """
                SELECT action_fingerprint, state FROM agent_action_journal
                WHERE task_id = ? AND step_id = ? AND attempt = ?
                """,
                (task_id, step_id, attempt),
            ).fetchone()
            if existing is not None:
                if existing["action_fingerprint"] != action_fingerprint:
                    raise RuntimeError("An action journal attempt was reused with different parameters.")
                raise RuntimeError(
                    f"This action attempt is already recorded as {existing['state']}; it will not be replayed."
                )
            cursor = connection.execute(
                """
                INSERT INTO agent_action_journal (
                    task_id, step_id, attempt, action_type, action_fingerprint,
                    state, result_json, started_at, finished_at
                ) VALUES (?, ?, ?, ?, ?, 'started', NULL, ?, NULL)
                """,
                (task_id, step_id, attempt, action_type, action_fingerprint, started_at),
            )
            return int(cursor.lastrowid)

    def finish_action(
        self,
        journal_id: int,
        *,
        state: str,
        result: dict[str, Any],
        finished_at: str,
    ) -> None:
        if state not in ("completed", "failed"):
            raise ValueError("Action journal final state must be completed or failed.")
        with self._db.transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE agent_action_journal
                SET state = ?, result_json = ?, finished_at = ?
                WHERE id = ? AND state = 'started'
                """,
                (state, json.dumps(result, ensure_ascii=False), finished_at, journal_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("The action journal entry was not in a writable started state.")

    def list_action_journal(self, task_id: str) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT id, step_id, attempt, action_type, action_fingerprint,
                       state, result_json, started_at, finished_at
                FROM agent_action_journal
                WHERE task_id = ?
                ORDER BY id ASC
                """,
                (task_id,),
            ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            raw_result = item.pop("result_json")
            try:
                item["result"] = json.loads(raw_result) if raw_result else None
            except json.JSONDecodeError:
                item["result"] = {"detail": "Stored action result could not be decoded."}
            items.append(item)
        return items


    def list_tasks(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT id, task, state, dry_run, provider, model, planner, created_at, updated_at
                FROM agent_tasks ORDER BY created_at DESC LIMIT ?
                """,
                (max(1, min(limit, 100)),),
            ).fetchall()
        return [
            {
                **dict(row),
                "dry_run": bool(row["dry_run"]),
            }
            for row in rows
        ]
