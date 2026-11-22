from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.database import Database
from app.db.store import IntentStore
from app.identities.service import IdentityService, _iso_now
from app.modules import PermissionDenied
from app.permissions.policy import assess

router = APIRouter(tags=["identity-management"])


def _parse_config(value: str) -> dict:
    """Parse a JSON config string, returning empty dict on failure."""
    try:
        return json.loads(value) if value else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def get_owner_id() -> str:
    """Derive the local user owner ID from the database path settings."""
    settings = get_settings()
    return settings.database_path.stem or "local_user"


def _get_service() -> IdentityService:
    settings = get_settings()
    db = Database(settings.database_path)
    db.initialize()
    store = IntentStore(db)
    return IdentityService(store)




def _require_owned_identity(service: IdentityService, identity_id: str) -> None:
    """Reject identity operations outside the current local user's ownership."""
    record = service._store._require_identity(identity_id)
    if record.owner_id != get_owner_id():
        raise PermissionError("You do not own this identity.")


class CreateIdentityRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=200)
    personality_config: dict = Field(default_factory=dict)
    role: str = Field(default="assistant", max_length=40)
    greeting: str = Field(default="Hello!", max_length=100)
    voice_configuration: dict = Field(default_factory=dict)
    appearance_configuration: dict = Field(default_factory=dict)
    behaviour_configuration: dict = Field(default_factory=dict)


class UpdateIdentityRequest(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=200)
    personality_config: dict | None = Field(default=None)
    role: str | None = Field(default=None, max_length=40)
    greeting: str | None = Field(default=None, max_length=100)
    voice_configuration: dict | None = Field(default=None)
    appearance_configuration: dict | None = Field(default=None)
    behaviour_configuration: dict | None = Field(default=None)


class IdentityResponse(BaseModel):
    id: str
    name: str
    description: str
    personality: dict
    role: str
    greeting: str
    voice: dict
    appearance: dict
    behaviour: dict
    associated_projects: list
    approved_tools: list
    memory_ownership: dict
    creation_timestamp: str
    updated_timestamp: str
    status: str
    schema_version: int


class RenameIdentityRequest(BaseModel):
    new_name: str = Field(min_length=1, max_length=80)


class IdentityListResponse(BaseModel):
    identities: list[IdentityResponse]
    count: int


@router.post("/identities")
def create_identity(payload: CreateIdentityRequest) -> dict[str, Any]:
    """Create a new AI identity.

    - The identity receives a stable, collision-resistant ID.
    - Owner ID is the local user identifier (loopback single-user design).
    - All configuration fields have sensible defaults.
    - The identity starts with 'active' status.
    """
    try:
        service = _get_service()
        # Use a simple owner identifier for local single-user design
        owner_id = get_owner_id()
        record = service.create_identity(
            owner_id=owner_id,
            name=payload.name,
            description=payload.description,
            personality_config=payload.personality_config,
            role=payload.role,
            greeting=payload.greeting,
            voice_configuration=payload.voice_configuration,
            appearance_configuration=payload.appearance_configuration,
            behaviour_configuration=payload.behaviour_configuration,
        )
        return {
            "id": record.id,
            "name": record.name,
            "description": record.description,
            "personality": _parse_config(record.personality_config),
            "role": record.role,
            "greeting": record.greeting,
            "voice": _parse_config(record.voice_configuration),
            "appearance": _parse_config(record.appearance_configuration),
            "behaviour": _parse_config(record.behaviour_configuration),
            "associated_projects": json.loads(record.associated_projects)
            if record.associated_projects
            else [],
            "approved_tools": json.loads(record.approved_tool_references)
            if record.approved_tool_references
            else [],
            "memory_ownership": _parse_config(record.memory_ownership_settings),
            "creation_timestamp": record.creation_timestamp,
            "updated_timestamp": record.updated_timestamp,
            "status": record.status,
            "schema_version": record.schema_version,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error creating identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/identities", response_model=IdentityListResponse)
def list_identities() -> dict[str, Any]:
    """List only identities owned by this local BOZZ user."""
    try:
        service = _get_service()
        records = service.list_identities(owner_id=get_owner_id())
        identities = [
            IdentityResponse(
                id=r["id"],
                name=r["name"],
                description=r["description"],
                personality=r.get("personality", {}),
                role=r["role"],
                greeting=r["greeting"],
                voice=r.get("voice", {}),
                appearance=r.get("appearance", {}),
                behaviour=r.get("behaviour", {}),
                associated_projects=r.get("associated_projects", []),
                approved_tools=r.get("approved_tools", []),
                memory_ownership=r.get("memory_ownership", {}),
                creation_timestamp=r["creation_timestamp"],
                updated_timestamp=r["updated_timestamp"],
                status=r["status"],
                schema_version=r["schema_version"],
            )
            for r in records
        ]
        return {"identities": identities, "count": len(identities)}
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error listing identities")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/identities/{identity_id}")
def get_identity(identity_id: str) -> dict[str, Any]:
    """Retrieve a specific identity by its stable ID.

    - Returns the full identity configuration.
    - Identity data is never exposed with another identity's private data.
    - Raises 404 if the identity is not found.
    """
    try:
        service = _get_service()
        _require_owned_identity(service, identity_id)
        identity = service.get_identity(identity_id)
        if identity is None:
            raise HTTPException(status_code=404, detail=f"Identity '{identity_id}' was not found.")
        return identity
    except HTTPException:
        raise
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error getting identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.patch("/identities/{identity_id}/rename")
def rename_identity(identity_id: str, payload: RenameIdentityRequest) -> dict[str, Any]:
    """Rename an identity.

    - Does not erase existing settings.
    - The new name must be at least 1 character and at most 80 characters.
    - Raises 404 if the identity is not found.
    - Raises 403 if the user does not own the identity (in multi-user setup).
    """
    try:
        service = _get_service()
        # For local single-user design, we allow the rename without
        # explicit ownership check, but the service layer still validates
        _require_owned_identity(service, identity_id)
        record = service.rename_identity(identity_id, payload.new_name)
        return {"id": record["id"], "name": record["name"], "description": record["description"], "status": record["status"], "updated_timestamp": record["updated_timestamp"]}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error renaming identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.patch("/identities/{identity_id}")
def edit_identity(identity_id: str, payload: UpdateIdentityRequest) -> dict[str, Any]:
    """Edit an identity's configuration.

    - Each field is optional; unspecified fields are preserved.
    - Personality/config changes are persisted immediately.
    - Raises 404 if the identity is not found.
    - Raises 403 if the user does not own the identity.
    """
    try:
        service = _get_service()
        _require_owned_identity(service, identity_id)
        record = service.edit_identity(
            identity_id,
            description=payload.description,
            personality_config=payload.personality_config,
            role=payload.role,
            greeting=payload.greeting,
            voice_configuration=payload.voice_configuration,
            appearance_configuration=payload.appearance_configuration,
            behaviour_configuration=payload.behaviour_configuration,
        )
        return {"id": record["id"], "name": record["name"], "description": record["description"], "status": record["status"], "updated_timestamp": record["updated_timestamp"]}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error editing identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/identities/{identity_id}/switch")
def switch_identity(identity_id: str) -> dict[str, Any]:
    """Switch the active identity for the calling owner.

    - The caller must own the identity being switched to.
    - Memory boundaries are enforced: the new identity's private memories
      are isolated from the previous identity's private memories.
    - Raises 404 if the identity is not found.
    - Raises 403 if the user does not own the identity.
    """
    try:
        service = _get_service()
        # In the local single-user design, the owner_id is derived from
        # the database path. For now, we accept the switch if the identity
        # exists and the caller provides the owner context.
        # The frontend must ensure the caller owns this identity.
        _require_owned_identity(service, identity_id)
        identity = service.switch_identity(identity_id, caller_owner_id=get_owner_id())
        return {
            "id": identity["id"],
            "name": identity["name"],
            "status": identity["status"],
            "memory_boundary_report": identity.get("memory_boundary_report", {}),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error switching identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/identities/{identity_id}/archive")
def archive_identity(identity_id: str) -> dict[str, Any]:
    """Archive an identity (mark as inactive, not delete).

    - The identity data is preserved; it is removed from the active list.
    - The currently-active identity cannot be archived if it would leave
      the user with no active identities.
    - Raises 404 if the identity is not found.
    - Raises 400 if the operation would leave the user with no active identities.
    """
    try:
        service = _get_service()
        # For local single-user design, we use the database path stem as owner
        _require_owned_identity(service, identity_id)
        service.archive_identity(identity_id, caller_owner_id=get_owner_id())
        updated = service.get_identity(identity_id)
        return {
            "id": updated["id"],
            "name": updated["name"],
            "status": updated["status"],
            "updated_timestamp": updated["updated_timestamp"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error archiving identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/identities/{identity_id}/delete")
def delete_identity(identity_id: str) -> dict[str, Any]:
    """Permanently delete an identity.

    - Returns True if deletion succeeded.
    - The currently-active identity cannot be deleted.
    - Private memories associated with the identity are not silently
      inherited by other identities.
    - Raises 404 if the identity is not found.
    - Raises 400 if the identity is the last active one (archive instead).
    """
    try:
        service = _get_service()
        _require_owned_identity(service, identity_id)
        result = service.delete_identity(identity_id, caller_owner_id=get_owner_id())
        if result:
            return {"result": "deleted", "id": identity_id}
        else:
            raise HTTPException(status_code=400, detail="Cannot delete the last active identity. Archive it instead.")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("identity-api")
        logger.exception("unexpected error deleting identity")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc