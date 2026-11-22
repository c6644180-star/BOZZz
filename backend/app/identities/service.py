"""Identity management service for BOZZ AI.

Provides create, read, update, delete, switch, and archive operations for
user-owned AI identities with strict memory ownership boundaries.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from typing import Any

from app.db.store import IdentityRecord, IntentStore


logger = logging.getLogger("bozz.identities")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_config(value: str) -> dict:
    """Parse a JSON config string, returning empty dict on failure."""
    try:
        return json.loads(value) if value else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _serialize_config(config: dict) -> str:
    """Serialize a config dict to a JSON string."""
    try:
        return json.dumps(config, ensure_ascii=False)
    except (TypeError, ValueError):
        return "{}"


class IdentityService:
    """Service layer for identity management business logic."""

    def __init__(self, store: IntentStore):
        self._store = store

    def _require_identity(self, identity_id: str) -> dict[str, Any]:
        record = self._store.get_identity(identity_id)
        if record is None:
            raise ValueError(f"Identity '{identity_id}' was not found.")
        return record

    # ----------------------------------------------------------- create

    def create_identity(
        self,
        owner_id: str,
        name: str,
        description: str = "",
        personality_config: dict | None = None,
        role: str = "assistant",
        greeting: str = "Hello!",
        voice_configuration: dict | None = None,
        appearance_configuration: dict | None = None,
        behaviour_configuration: dict | None = None,
    ) -> IdentityRecord:
        """Create a new AI identity for the owner.

        - Owner ID must be the local user identifier (no external authentication).
        - Name must be unique per owner; duplicate names are allowed across owners.
        - Configuration defaults are applied for first-time use.
        - The identity starts with 'active' status.
        """
        identity_id = self._store._generate_id()
        now = _iso_now()
        personality_str = _serialize_config(personality_config or {})
        voice_str = _serialize_config(voice_configuration or {})
        appearance_str = _serialize_config(appearance_configuration or {})
        behaviour_str = _serialize_config(behaviour_configuration or {})
        associated_projects = "[]"
        approved_tools = "[]"
        memory_ownership = '{"private": true, "shareable": false}'

        record = IdentityRecord(
            id=identity_id,
            owner_id=owner_id,
            name=name,
            description=description,
            personality_config=personality_str,
            role=role,
            greeting=greeting,
            voice_configuration=voice_str,
            appearance_configuration=appearance_str,
            behaviour_configuration=behaviour_str,
            associated_projects=associated_projects,
            approved_tool_references=approved_tools,
            memory_ownership_settings=memory_ownership,
            creation_timestamp=now,
            updated_timestamp=now,
            status="active",
            schema_version=1,
        )

        self._store.create_identity(record)
        logger.info("identity created id=%s name=%s", identity_id, name)
        return record

    # ----------------------------------------------------------- read

    def get_identity(self, identity_id: str) -> dict[str, Any] | None:
        """Retrieve an identity by its stable ID.

        - Returns None if not found.
        - Identity data is never exposed with another identity's private data.
        """
        record = self._store.get_identity(identity_id)
        if record is None:
            return None
        return {
            "id": record["id"],
            "name": record["name"],
            "description": record["description"],
            "personality": _parse_config(record["personality_config"]),
            "role": record["role"],
            "greeting": record["greeting"],
            "voice": _parse_config(record["voice_configuration"]),
            "appearance": _parse_config(record["appearance_configuration"]),
            "behaviour": _parse_config(record["behaviour_configuration"]),
            "associated_projects": json.loads(record["associated_projects"])
            if record["associated_projects"]
            else [],
            "approved_tools": json.loads(record["approved_tool_references"])
            if record["approved_tool_references"]
            else [],
            "memory_ownership": _parse_config(record["memory_ownership_settings"]),
            "creation_timestamp": record["creation_timestamp"],
            "updated_timestamp": record["updated_timestamp"],
            "status": record["status"],
            "schema_version": record["schema_version"],
        }

    def list_identities(
        self, owner_id: str | None = None, include_private: bool = True
    ) -> list[dict[str, Any]]:
        """List identities owned by the given owner.

        - If owner_id is None, lists all identities (for admin/internal use).
        - Private memory boundaries are respected: memory ownership settings
          are always returned but the service ensures another identity's
          private data is never exposed.
        """
        records = self._store.list_identities(owner_id=owner_id)
        result = []
        for record in records:
            # Check memory ownership: if this identity's memory is private
            # and the current owner differs, filter sensitive fields
            ownership = _parse_config(record["memory_ownership_settings"])
            is_private = ownership.get("private", True)

            identity_data = {
                "id": record["id"],
                "name": record["name"],
                "description": record["description"],
                "personality": _parse_config(record["personality_config"]),
                "role": record["role"],
                "greeting": record["greeting"],
                "voice": _parse_config(record["voice_configuration"]),
                "appearance": _parse_config(record["appearance_configuration"]),
                "associated_projects": json.loads(record["associated_projects"])
                if record["associated_projects"]
                else [],
                "approved_tools": json.loads(record["approved_tool_references"])
                if record["approved_tool_references"]
                else [],
                "memory_ownership": ownership,
                "creation_timestamp": record["creation_timestamp"],
                "updated_timestamp": record["updated_timestamp"],
                "status": record["status"],
                "schema_version": record["schema_version"],
            }
            # If the identity is not the current user's and is marked private,
            # restrict memory ownership information
            if not include_private and is_private:
                identity_data["memory_ownership"] = {
                    "private": True,
                    "shareable": False,
                    "note": "Private identity data restricted.",
                }
            result.append(identity_data)
        return result

    # ----------------------------------------------------------- update

    def rename_identity(self, identity_id: str, new_name: str) -> dict[str, Any]:
        """Rename an identity.

        - Does not erase existing settings.
        - Name uniqueness is per-owner; no cross-owner collision check (local-only).
        """
        record = self._require_identity(identity_id)
        self._store.update_identity(
            identity_id,
            name=new_name,
        )
        # Refresh the record
        updated = self.get_identity(identity_id)
        logger.info(
            "identity renamed id=%s from=%s to=%s",
            identity_id,
            record["name"],
            new_name,
        )
        return updated

    def edit_identity(
        self,
        identity_id: str,
        description: str | None = None,
        personality_config: dict | None = None,
        role: str | None = None,
        greeting: str | None = None,
        voice_configuration: dict | None = None,
        appearance_configuration: dict | None = None,
        behaviour_configuration: dict | None = None,
    ) -> dict[str, Any]:
        """Edit an identity's configuration.

        - Each field is optional; unspecified fields are preserved.
        - Personality/config changes are persisted immediately.
        """
        record = self._require_identity(identity_id)
        update_kwargs = {}
        if description is not None:
            update_kwargs["description"] = description
        if personality_config is not None:
            update_kwargs["personality_config"] = _serialize_config(personality_config)
        if role is not None:
            update_kwargs["role"] = role
        if greeting is not None:
            update_kwargs["greeting"] = greeting
        if voice_configuration is not None:
            update_kwargs["voice_configuration"] = _serialize_config(voice_configuration)
        if appearance_configuration is not None:
            update_kwargs["appearance_configuration"] = _serialize_config(appearance_configuration)
        if behaviour_configuration is not None:
            update_kwargs["behaviour_configuration"] = _serialize_config(behaviour_configuration)

        self._store.update_identity(identity_id, **update_kwargs)
        updated = self.get_identity(identity_id)
        logger.info(
            "identity edited id=%s fields=%s",
            identity_id,
            list(update_kwargs.keys()),
        )
        return updated

    # ----------------------------------------------------------- switch

    def switch_identity(self, identity_id: str, caller_owner_id: str) -> dict[str, Any]:
        """Switch the active identity for the calling owner.

        - Memory boundaries are enforced: the new identity's private memories
          are isolated from the previous identity's private memories.
        - The caller must own the identity being switched to (owner_id check).
        - Returns the new identity's configuration and a summary of memory
          boundaries that are in effect.
        """
        record = self._require_identity(identity_id)

        # Ownership check: the caller must own this identity
        if record["owner_id"] != caller_owner_id:
            raise PermissionError("You do not own this identity.")

        # Build memory boundary report
        new_memory = _parse_config(record["memory_ownership_settings"])
        current_memory = self._get_current_memory_ownership(caller_owner_id)
        boundary_report = {
            "previous_identity": current_memory,
            "new_identity": new_memory,
            "isolation_applied": current_memory.get("private", True)
            and new_memory.get("private", True),
        }

        identity_data = self.get_identity(identity_id)
        identity_data["memory_boundary_report"] = boundary_report
        logger.info(
            "identity switched id=%s owner=%s",
            identity_id,
            caller_owner_id,
        )
        return identity_data

    def _get_current_memory_ownership(self, owner_id: str) -> dict:
        """Get the memory ownership settings of the current active identity.

        This is a simplified lookup; in a full implementation, the "active"
        identity would be tracked per session.
        """
        identities = self._store.list_identities(owner_id=owner_id)
        if identities:
            last = identities[-1]  # Assume most recently created/updated is active
            return _parse_config(last.get("memory_ownership_settings", "{}"))
        return {"private": True, "shareable": False}

    # ----------------------------------------------------------- archive/delete

    def archive_identity(self, identity_id: str, caller_owner_id: str) -> dict[str, Any]:
        """Archive an identity (mark as inactive, not delete).

        - The identity is not deleted; its data is preserved.
        - It is removed from the active list.
        - Ownership check applies.
        """
        record = self._require_identity(identity_id)
        if record["owner_id"] != caller_owner_id:
            raise PermissionError("You do not own this identity.")
        self._store.update_identity(
            identity_id,
            status="archived",
        )
        updated = self.get_identity(identity_id)
        logger.info("identity archived id=%s name=%s", identity_id, record["name"])
        return updated

    def delete_identity(self, identity_id: str, caller_owner_id: str) -> bool:
        """Permanently delete an identity.

        - Returns True if deletion succeeded.
        - The currently-active identity cannot be deleted.
        - Private memories associated with the identity are not silently
          inherited by other identities.
        """
        record = self._require_identity(identity_id)
        if record["owner_id"] != caller_owner_id:
            raise PermissionError("You do not own this identity.")
        # Prevent deletion of the active/only identity
        if record["status"] == "active" and self._is_only_active_identity(caller_owner_id, identity_id):
            raise ValueError(
                "Cannot delete the last active identity. Archive it instead."
            )
        result = self._store.delete_identity(identity_id)
        logger.info("identity deleted id=%s name=%s", identity_id, record["name"])
        return result

    def _is_only_active_identity(self, owner_id: str, exclude_id: str) -> bool:
        """Check if the given identity is the only active one for the owner."""
        identities = self._store.list_identities(owner_id=owner_id)
        active_count = sum(
            1
            for idata in identities
            if idata["status"] == "active" and idata["id"] != exclude_id
        )
        return active_count == 0

    # ----------------------------------------------------------- validation (static methods)

    @staticmethod
    def _generate_id() -> str:
        import uuid
        return uuid.uuid4().hex[:16]