"""Persistence for computer-agent tasks and step results.

Screenshots, page bodies and typed secrets are never written here. Step detail
is the short human-readable result from the executor.
"""

from __future__ import annotations

from typing import Any
import json

from app.db.database import Database


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
        payload["steps"] = [dict(item) for item in steps]
        return payload

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
