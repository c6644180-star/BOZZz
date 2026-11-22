"""Append-oriented repositories for intents, workflow steps, and audit events."""

from __future__ import annotations

from dataclasses import dataclass
import uuid
from typing import Any, TypeVar

from app.db.database import Database

T = TypeVar("T", bound="BaseRecord")


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


@dataclass(frozen=True)
class IdentityRecord:
    id: str
    owner_id: str
    name: str
    description: str
    personality_config: str
    role: str
    greeting: str
    voice_configuration: str
    appearance_configuration: str
    behaviour_configuration: str
    associated_projects: str
    approved_tool_references: str
    memory_ownership_settings: str
    creation_timestamp: str
    updated_timestamp: str
    status: str
    schema_version: int


class BaseRecord:
    """Base class for record dataclasses with common serialization."""

    @staticmethod
    def from_dict(data: dict) -> "BaseRecord":
        """Create a record from a dictionary, handling missing keys with defaults."""
        raise NotImplementedError

    def to_dict(self) -> dict:
        """Convert the record to a dictionary for database storage."""
        raise NotImplementedError


class IntentStore:
    def __init__(self, database: Database):
        self._db = database
        self._db.initialize()

    @staticmethod
    def _generate_id() -> str:
        """Generate a compact, non-PII identifier for local records."""
        return uuid.uuid4().hex[:16]

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

    def create_identity(self, record: IdentityRecord) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO identities (
                    id, owner_id, name, description, personality_config,
                    role, greeting, voice_configuration, appearance_configuration,
                    behaviour_configuration, associated_projects,
                    approved_tool_references, memory_ownership_settings,
                    creation_timestamp, updated_timestamp, status, schema_version
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.owner_id,
                    record.name,
                    record.description,
                    record.personality_config,
                    record.role,
                    record.greeting,
                    record.voice_configuration,
                    record.appearance_configuration,
                    record.behaviour_configuration,
                    record.associated_projects,
                    record.approved_tool_references,
                    record.memory_ownership_settings,
                    record.creation_timestamp,
                    record.updated_timestamp,
                    record.status,
                    record.schema_version,
                ),
            )

    def update_identity(
        self,
        identity_id: str,
        name: str | None = None,
        description: str | None = None,
        personality_config: str | None = None,
        role: str | None = None,
        greeting: str | None = None,
        voice_configuration: str | None = None,
        appearance_configuration: str | None = None,
        behaviour_configuration: str | None = None,
        status: str | None = None,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                UPDATE identities
                SET
                    name = COALESCE(?, name),
                    description = COALESCE(?, description),
                    personality_config = COALESCE(?, personality_config),
                    role = COALESCE(?, role),
                    greeting = COALESCE(?, greeting),
                    voice_configuration = COALESCE(?, voice_configuration),
                    appearance_configuration = COALESCE(?, appearance_configuration),
                    behaviour_configuration = COALESCE(?, behaviour_configuration),
                    status = COALESCE(?, status),
                    updated_timestamp = ?
                WHERE id = ?
                """,
                (
                    name, description, personality_config, role,
                    greeting, voice_configuration, appearance_configuration,
                    behaviour_configuration,
                    status,
                    self._iso_now(),
                    identity_id,
                ),
            )

    def get_identity(self, identity_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT * FROM identities WHERE id = ?", (identity_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_identities(self, owner_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            if owner_id:
                rows = connection.execute(
                    """
                    SELECT * FROM identities
                    WHERE owner_id = ?
                    ORDER BY name ASC LIMIT ?
                    """,
                    (owner_id, max(1, min(limit, 100))),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM identities
                    ORDER BY name ASC LIMIT ?
                    """,
                    (max(1, min(limit, 100)),),
                ).fetchall()
            return [dict(row) for row in rows]

    def delete_identity(self, identity_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM identities WHERE id = ?", (identity_id,)
            )
            return cursor.rowcount > 0

    def create_preference_profile(self, record: dict[str, Any]) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO preference_profiles (
                    id, owner_id, identity_id, name, visual_preferences,
                    ai_behaviour_preferences, productivity_preferences,
                    accessibility_preferences, functional_preferences,
                    privacy_preferences, project_specific_settings,
                    creation_timestamp, updated_timestamp, status, schema_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["id"],
                    record["owner_id"],
                    record["identity_id"],
                    record["name"],
                    record["visual_preferences"],
                    record["ai_behaviour_preferences"],
                    record["productivity_preferences"],
                    record["accessibility_preferences"],
                    record["functional_preferences"],
                    record["privacy_preferences"],
                    record["project_specific_settings"],
                    record["creation_timestamp"],
                    record["updated_timestamp"],
                    record["status"],
                    record["schema_version"],
                ),
            )

    def update_preference_profile(
        self,
        profile_id: str,
        name: str | None = None,
        visual_preferences: str | None = None,
        ai_behaviour_preferences: str | None = None,
        productivity_preferences: str | None = None,
        accessibility_preferences: str | None = None,
        functional_preferences: str | None = None,
        privacy_preferences: str | None = None,
        project_specific_settings: str | None = None,
        updated_timestamp: str | None = None,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                UPDATE preference_profiles
                SET
                    name = COALESCE(?, name),
                    visual_preferences = COALESCE(?, visual_preferences),
                    ai_behaviour_preferences = COALESCE(?, ai_behaviour_preferences),
                    productivity_preferences = COALESCE(?, productivity_preferences),
                    accessibility_preferences = COALESCE(?, accessibility_preferences),
                    functional_preferences = COALESCE(?, functional_preferences),
                    privacy_preferences = COALESCE(?, privacy_preferences),
                    project_specific_settings = COALESCE(?, project_specific_settings),
                    updated_timestamp = ?
                WHERE id = ?
                """,
                (
                    name, visual_preferences, ai_behaviour_preferences,
                    productivity_preferences, accessibility_preferences,
                    functional_preferences, privacy_preferences,
                    project_specific_settings,
                    updated_timestamp or self._iso_now(),
                    profile_id,
                ),
            )

    def get_preference_profile(self, profile_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT * FROM preference_profiles WHERE id = ?", (profile_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_preference_profiles(
        self, identity_id: str | None = None, owner_id: str | None = None
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[str] = []
        if identity_id:
            clauses.append("identity_id = ?")
            params.append(identity_id)
        if owner_id:
            clauses.append("owner_id = ?")
            params.append(owner_id)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._db.read() as connection:
            rows = connection.execute(
                f"SELECT * FROM preference_profiles{where} ORDER BY name ASC",
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_preference_profile(self, profile_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM preference_profiles WHERE id = ?", (profile_id,)
            )
            return cursor.rowcount > 0

    def create_bid(self, record: dict[str, Any]) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO bids (
                    bid_id, owner_id, title, description, ai_interpretation,
                    intended_outcome, category, related_project, creation_timestamp,
                    updated_timestamp, status, schema_version, version,
                    suggestions, approved_modifications, dependencies,
                    related_ideas, sharing_permissions, implementation_references,
                    testing_evidence, original_title, original_description
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["bid_id"],
                    record["owner_id"],
                    record["title"],
                    record["description"],
                    record["ai_interpretation"],
                    record["intended_outcome"],
                    record["category"],
                    record["related_project"],
                    record["creation_timestamp"],
                    record["updated_timestamp"],
                    record["status"],
                    record["schema_version"],
                    record["version"],
                    record["suggestions"],
                    record["approved_modifications"],
                    record["dependencies"],
                    record["related_ideas"],
                    record["sharing_permissions"],
                    record["implementation_references"],
                    record["testing_evidence"],
                    record["original_title"],
                    record["original_description"],
                ),
            )

    def get_bid(self, bid_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute("SELECT * FROM bids WHERE bid_id = ?", (bid_id,)).fetchone()
        return dict(row) if row else None

    def update_bid(
        self,
        bid_id: str,
        title: str | None = None,
        description: str | None = None,
        ai_interpretation: str | None = None,
        intended_outcome: str | None = None,
        category: str | None = None,
        related_project: str | None = None,
        status: str | None = None,
        version: int | None = None,
        suggestions: str | None = None,
        approved_modifications: str | None = None,
        dependencies: str | None = None,
        related_ideas: str | None = None,
        sharing_permissions: str | None = None,
        implementation_references: str | None = None,
        testing_evidence: str | None = None,
        updated_timestamp: str | None = None,
    ) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                UPDATE bids
                SET
                    title = COALESCE(?, title),
                    description = COALESCE(?, description),
                    ai_interpretation = COALESCE(?, ai_interpretation),
                    intended_outcome = COALESCE(?, intended_outcome),
                    category = COALESCE(?, category),
                    related_project = COALESCE(?, related_project),
                    status = COALESCE(?, status),
                    version = COALESCE(?, version),
                    suggestions = COALESCE(?, suggestions),
                    approved_modifications = COALESCE(?, approved_modifications),
                    dependencies = COALESCE(?, dependencies),
                    related_ideas = COALESCE(?, related_ideas),
                    sharing_permissions = COALESCE(?, sharing_permissions),
                    implementation_references = COALESCE(?, implementation_references),
                    testing_evidence = COALESCE(?, testing_evidence),
                    updated_timestamp = ?
                WHERE bid_id = ?
                """,
                (
                    title, description, ai_interpretation, intended_outcome,
                    category, related_project, status, version,
                    suggestions, approved_modifications, dependencies,
                    related_ideas, sharing_permissions, implementation_references,
                    testing_evidence,
                    updated_timestamp or self._iso_now(),
                    bid_id,
                ),
            )

    def search_bids_by_description(self, query: str, owner_id: str | None = None) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            like_query = f"%{query}%"
            if owner_id:
                rows = connection.execute(
                    """
                    SELECT * FROM bids
                    WHERE (description LIKE ? OR title LIKE ?)
                    AND owner_id = ?
                    ORDER BY creation_timestamp DESC
                    """,
                    (like_query, like_query, owner_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM bids
                    WHERE description LIKE ? OR title LIKE ?
                    ORDER BY creation_timestamp DESC
                    """,
                    (like_query, like_query),
                ).fetchall()
        return [dict(row) for row in rows]

    def search_bids_by_category(self, category: str, owner_id: str | None = None) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            like_category = f"%{category}%"
            if owner_id:
                rows = connection.execute(
                    """
                    SELECT * FROM bids
                    WHERE category LIKE ?
                    AND owner_id = ?
                    ORDER BY creation_timestamp DESC
                    """,
                    (like_category, owner_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM bids
                    WHERE category LIKE ?
                    ORDER BY creation_timestamp DESC
                    """,
                    (like_category,),
                ).fetchall()
        return [dict(row) for row in rows]

    def search_bids_by_project(self, project: str, owner_id: str | None = None) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            like_project = f"%{project}%"
            if owner_id:
                rows = connection.execute(
                    """
                    SELECT * FROM bids
                    WHERE related_project LIKE ?
                    AND owner_id = ?
                    ORDER BY creation_timestamp DESC
                    """,
                    (like_project, owner_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM bids
                    WHERE related_project LIKE ?
                    ORDER BY creation_timestamp DESC
                    """,
                    (like_project,),
                ).fetchall()
        return [dict(row) for row in rows]

    def delete_bid(self, bid_id: str, caller_owner_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM bids WHERE bid_id = ? AND owner_id = ?", (bid_id, caller_owner_id)
            )
            return cursor.rowcount > 0

    def _iso_now(self) -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat(timespec="seconds")
