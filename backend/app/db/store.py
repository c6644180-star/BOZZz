"""Append-oriented repositories for intents, workflow steps, and audit events."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.db.database import Database


@dataclass(frozen=True)
class IntentRecord:
    id: str
    raw_text: str
    status: str
    plan_json: str
    approval_id: str | None
    approval_required: bool
    created_at: str
    updated_at: str
    report_json: str | None = None


class IntentStore:
    def __init__(self, database: Database):
        self._db = database
        self._db.initialize()

    def create_intent(self, record: IntentRecord) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO intents (
                    id, raw_text, status, plan_json, report_json,
                    approval_id, approval_required, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.raw_text,
                    record.status,
                    record.plan_json,
                    record.report_json,
                    record.approval_id,
                    int(record.approval_required),
                    record.created_at,
                    record.updated_at,
                ),
            )

    def update_intent(
        self,
        intent_id: str,
        status: str,
        updated_at: str,
        report_json: str | None = None,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                UPDATE intents
                SET status = ?, updated_at = ?, report_json = COALESCE(?, report_json)
                WHERE id = ?
                """,
                (status, updated_at, report_json, intent_id),
            )

    def get_intent(self, intent_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT * FROM intents WHERE id = ?", (intent_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_intents(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT id, raw_text, status, created_at, updated_at
                FROM intents ORDER BY created_at DESC LIMIT ?
                """,
                (max(1, min(limit, 100)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def append_step(
        self, intent_id: str, step: str, status: str, detail: str, created_at: str
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO intent_steps (intent_id, step, status, detail, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (intent_id, step, status, detail, created_at),
            )

    def list_steps(self, intent_id: str) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT step, status, detail, created_at
                FROM intent_steps WHERE intent_id = ? ORDER BY id ASC
                """,
                (intent_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def append_audit(
        self,
        *,
        intent_id: str | None,
        event: str,
        outcome: str,
        detail: str,
        created_at: str,
        action_type: str | None = None,
        target: str | None = None,
        risk: str | None = None,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO audit_log (
                    intent_id, event, action_type, target, risk,
                    outcome, detail, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (intent_id, event, action_type, target, risk, outcome, detail, created_at),
            )

    def list_audit(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_module_permissions(self, module_id: str) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                "SELECT permission, granted, updated_at FROM module_permissions WHERE module_id = ?",
                (module_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def set_module_permission(
        self, module_id: str, permission: str, granted: bool, updated_at: str
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO module_permissions (module_id, permission, granted, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(module_id, permission) DO UPDATE SET
                    granted = excluded.granted,
                    updated_at = excluded.updated_at
                """,
                (module_id, permission, int(granted), updated_at),
            )
