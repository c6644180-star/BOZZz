from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.database import Database
from app.preferences.service import PreferenceService, _iso_now
from app.db.store import IntentStore
from app.modules import PermissionDenied


def get_owner_id() -> str:
    """Derive the local user owner ID from the database path settings."""
    settings = get_settings()
    return settings.database_path.stem or "local_user"


router = APIRouter(tags=["preference-management"])


def _get_service() -> PreferenceService:
    settings = get_settings()
    db = Database(settings.database_path)
    db.initialize()
    store = IntentStore(db)
    return PreferenceService(store)


class CreatePreferenceProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    identity_id: str = Field(min_length=1, max_length=32)
    visual_preferences: dict = Field(default_factory=dict)
    ai_behaviour_preferences: dict = Field(default_factory=dict)
    productivity_preferences: dict = Field(default_factory=dict)
    accessibility_preferences: dict = Field(default_factory=dict)
    functional_preferences: dict = Field(default_factory=dict)
    privacy_preferences: dict = Field(default_factory=dict)
    project_specific_settings: dict = Field(default_factory=dict)


class UpdatePreferenceProfileRequest(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    visual_preferences: dict | None = Field(default=None)
    ai_behaviour_preferences: dict | None = Field(default=None)
    productivity_preferences: dict | None = Field(default=None)
    accessibility_preferences: dict | None = Field(default=None)
    functional_preferences: dict | None = Field(default=None)
    privacy_preferences: dict | None = Field(default=None)
    project_specific_settings: dict | None = Field(default=None)


class PreferenceProfileResponse(BaseModel):
    id: str
    name: str
    identity_id: str
    owner_id: str
    visual_preferences: dict
    ai_behaviour_preferences: dict
    productivity_preferences: dict
    accessibility_preferences: dict
    functional_preferences: dict
    privacy_preferences: dict
    project_specific_settings: dict
    creation_timestamp: str
    updated_timestamp: str
    status: str
    schema_version: int


class PreferenceListResponse(BaseModel):
    identities: list[PreferenceProfileResponse]
    count: int


class ProposePreferenceChangeRequest(BaseModel):
    changes: dict[str, Any] = Field(...)


class ProposePreferenceChangeResponse(BaseModel):
    profile_id: str
    profile_name: str
    current_state: dict[str, Any]
    proposed_state: dict[str, Any]
    affected_categories: list[str]
    change_summary: str
    requires_approval: bool
    workflow_stage: str


@router.post("/preference-profiles")
def create_preference_profile(payload: CreatePreferenceProfileRequest) -> dict[str, Any]:
    """Create a new preference profile for an identity.

    - Profile receives a stable ID.
    - Linked to an identity (from Phase 1) so preferences switch with identity.
    - All preference categories default to empty dicts if not specified.
    - Profile starts with 'active' status.
    """
    try:
        service = _get_service()
        record = service.create_preference_profile(
            owner_id=get_owner_id(),
            identity_id=payload.identity_id,
            name=payload.name,
            visual_preferences=payload.visual_preferences,
            ai_behaviour_preferences=payload.ai_behaviour_preferences,
            productivity_preferences=payload.productivity_preferences,
            accessibility_preferences=payload.accessibility_preferences,
            functional_preferences=payload.functional_preferences,
            privacy_preferences=payload.privacy_preferences,
            project_specific_settings=payload.project_specific_settings,
        )
        return {
            "id": record["id"],
            "name": record["name"],
            "identity_id": record["identity_id"],
            "owner_id": record["owner_id"],
            "visual_preferences": record["visual_preferences"],
            "ai_behaviour_preferences": record["ai_behaviour_preferences"],
            "productivity_preferences": record["productivity_preferences"],
            "accessibility_preferences": record["accessibility_preferences"],
            "functional_preferences": record["functional_preferences"],
            "privacy_preferences": record["privacy_preferences"],
            "project_specific_settings": record["project_specific_settings"],
            "creation_timestamp": record["creation_timestamp"],
            "updated_timestamp": record["updated_timestamp"],
            "status": record["status"],
            "schema_version": record["schema_version"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error creating preference profile")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/preference-profiles", response_model=PreferenceListResponse)
def list_preference_profiles(
    identity_id: str | None = Query(default=None, min_length=1),
) -> dict[str, Any]:
    """List preference profiles.

    - If identity_id is given, lists profiles for that identity.
    - If owner_id is given, lists profiles for that owner.
    - Profiles are sorted by name alphabetically.
    """
    try:
        service = _get_service()
        records = service.list_preference_profiles(identity_id=identity_id, owner_id=get_owner_id())
        return {"identities": records, "count": len(records)}
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error listing preference profiles")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/preference-profiles/{profile_id}")
def get_preference_profile(profile_id: str) -> dict[str, Any]:
    """Retrieve a specific preference profile by its stable ID.

    - Returns the full preference profile configuration.
    - Raises 404 if the profile is not found.
    """
    try:
        service = _get_service()
        profile = service.get_preference_profile(profile_id)
        if profile is None or profile["owner_id"] != get_owner_id():
            raise HTTPException(status_code=404, detail=f"Preference profile '{profile_id}' was not found.")
        return profile
    except HTTPException:
        raise
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error getting preference profile")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.patch("/preference-profiles/{profile_id}")
def update_preference_profile(profile_id: str, payload: UpdatePreferenceProfileRequest) -> dict[str, Any]:
    """Edit a preference profile.

    - Each field is optional; unspecified fields are preserved.
    - Changes are persisted immediately.
    - Raises 404 if the profile is not found.
    """
    try:
        service = _get_service()
        existing = service.get_preference_profile(profile_id)
        if existing is None or existing["owner_id"] != get_owner_id():
            raise HTTPException(status_code=404, detail="Preference profile not found.")
        record = service.edit_preference_profile(
            profile_id,
            name=payload.name,
            visual_preferences=payload.visual_preferences,
            ai_behaviour_preferences=payload.ai_behaviour_preferences,
            productivity_preferences=payload.productivity_preferences,
            accessibility_preferences=payload.accessibility_preferences,
            functional_preferences=payload.functional_preferences,
            privacy_preferences=payload.privacy_preferences,
            project_specific_settings=payload.project_specific_settings,
        )
        return {
            "id": record["id"],
            "name": record["name"],
            "identity_id": record["identity_id"],
            "owner_id": record["owner_id"],
            "visual_preferences": record["visual_preferences"],
            "ai_behaviour_preferences": record["ai_behaviour_preferences"],
            "productivity_preferences": record["productivity_preferences"],
            "accessibility_preferences": record["accessibility_preferences"],
            "functional_preferences": record["functional_preferences"],
            "privacy_preferences": record["privacy_preferences"],
            "project_specific_settings": record["project_specific_settings"],
            "creation_timestamp": record["creation_timestamp"],
            "updated_timestamp": record["updated_timestamp"],
            "status": record["status"],
            "schema_version": record["schema_version"],
        }
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error editing preference profile")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/preference-profiles/{profile_id}/propose-change")
def propose_preference_change(
    profile_id: str,
    payload: ProposePreferenceChangeRequest,
) -> dict[str, Any]:
    """Propose a preference change following the UNDERSTAND → IDENTIFY → PREVIEW → APPROVE → APPLY → VERIFY → SAVE workflow.

    Returns a proposal record suitable for UI display and approval.
    """
    try:
        service = _get_service()
        proposal = service.propose_preference_change(
            profile_id=profile_id,
            changes=payload.changes,
            caller_owner_id=get_owner_id(),
        )
        return {
            "profile_id": proposal["profile_id"],
            "profile_name": proposal["profile_name"],
            "current_state": proposal["current_state"],
            "proposed_state": proposal["proposed_state"],
            "affected_categories": proposal["affected_categories"],
            "change_summary": proposal["change_summary"],
            "requires_approval": proposal["requires_approval"],
            "workflow_stage": proposal["workflow_stage"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error proposing preference change")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/preference-profiles/{profile_id}/apply-change")
def apply_preference_change(profile_id: str) -> dict[str, Any]:
    """Apply a previously approved preference change.

    This is called after the user has approved the change preview.
    The changes are re-read and verified, then saved.
    """
    try:
        service = _get_service()
        updated = service.apply_preference_change(profile_id)
        return {
            "id": updated["id"],
            "name": updated["name"],
            "status": updated["status"],
            "updated_timestamp": updated["updated_timestamp"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error applying preference change")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/preference-profiles/{profile_id}/reset")
def reset_preference_profile(profile_id: str) -> dict[str, Any]:
    """Reset a preference profile to default values.

    Defaults: all preference categories set to empty dicts ({}).
    """
    try:
        service = _get_service()
        updated = service.reset_preference_profile(profile_id, caller_owner_id=get_owner_id())
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
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error resetting preference profile")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc

@router.post("/preference-profiles/{profile_id}/delete")
def delete_preference_profile(profile_id: str) -> dict[str, Any]:
    """Delete a profile owned by the current local user."""
    try:
        deleted = _get_service().delete_preference_profile(
            profile_id, caller_owner_id=get_owner_id()
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Preference profile was not found.")
        return {"result": "deleted", "id": profile_id}
    except HTTPException:
        raise
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("preference-api")
        logger.exception("unexpected error deleting preference profile")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc
