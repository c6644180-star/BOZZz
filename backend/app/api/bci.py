"""Local BCI API: conversations, imports, drafts, style and AI actions.

There is intentionally no send route. Every route below either reads local
SQLite data or stores a local draft; nothing contacts a messaging service.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.ai.registry import get_registry
from app.api.modules import get_permissions
from app.bci.service import (
    BciNotFound,
    BciService,
    BciValidationError,
    ProviderConfirmationRequired,
    ProviderUnavailable,
)
from app.bci.store import BciStore
from app.core.config import get_settings
from app.db.database import Database
from app.db.store import IntentStore
from app.modules import PermissionDenied

router = APIRouter(tags=["bci"])


@lru_cache(maxsize=1)
def get_bci_service() -> BciService:
    settings = get_settings()
    database = Database(settings.database_path)
    return BciService(BciStore(database), IntentStore(database), get_registry().default())


def _enforce() -> None:
    try:
        get_permissions().enforce("bci", ["message_data"])
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDenied):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, BciNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ProviderConfirmationRequired):
        return HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "provider": exc.provider,
                "confirmation_required": True,
            },
        )
    if isinstance(exc, ProviderUnavailable):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, BciValidationError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


class MessageIn(BaseModel):
    sender: str = Field(default="", max_length=120)
    text: str = Field(min_length=1, max_length=20_000)
    direction: Literal["inbound", "outbound"] | None = None
    sent_at: str = Field(default="", max_length=40)


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    source: str = Field(default="manual", max_length=32)
    messages: list[MessageIn] = Field(default_factory=list, max_length=2_001)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    retention_days: int | None = None


class ImportRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=2_100_000)
    title: str | None = Field(default=None, max_length=200)


class ConfirmRequest(BaseModel):
    confirm: bool = False


class ProviderConfirmRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=60)
    confirm: bool = False


class DraftCreate(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    language: str | None = Field(default=None, max_length=40)
    tone: str | None = Field(default=None, max_length=40)


class DraftUpdate(BaseModel):
    text: str | None = Field(default=None, max_length=20_000)
    language: str | None = Field(default=None, max_length=40)
    tone: str | None = Field(default=None, max_length=40)


class ActionRequest(BaseModel):
    action: Literal["summarise", "unanswered", "attention", "draft", "rewrite", "translate"]
    text: str | None = Field(default=None, max_length=20_000)
    draft_id: str | None = Field(default=None, max_length=80)
    language: str | None = Field(default=None, max_length=40)
    tone: str | None = Field(default=None, max_length=40)
    instruction: str | None = Field(default=None, max_length=1_000)


class SettingsUpdate(BaseModel):
    retention_days: int


class StyleUpdate(BaseModel):
    language: str = Field(default="English", max_length=40)
    formality: str = Field(default="neutral", max_length=20)
    length: str = Field(default="medium", max_length=20)
    tone: str = Field(default="neutral", max_length=20)
    expressions: list[str] = Field(default_factory=list, max_length=12)


# ---------------------------------------------------------------- provider
@router.get("/bci/provider")
def provider_info() -> dict[str, Any]:
    """Disclosure is readable before the permission is granted so the page can
    explain what the feature would use. No conversation text is returned."""
    return {
        **get_bci_service().provider_info(),
        "permission_granted": get_permissions().is_granted("bci", "message_data"),
    }


@router.post("/bci/provider/confirm")
def confirm_provider(payload: ProviderConfirmRequest) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().confirm_provider(payload.provider, payload.confirm)
    except (BciValidationError, ProviderConfirmationRequired) as exc:
        raise _error(exc) from exc


# ---------------------------------------------------------------- settings
@router.get("/bci/settings")
def get_settings_view() -> dict[str, Any]:
    _enforce()
    return get_bci_service().settings()


@router.put("/bci/settings")
def update_settings(payload: SettingsUpdate) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().update_settings(payload.retention_days)
    except BciValidationError as exc:
        raise _error(exc) from exc


# ------------------------------------------------------------------- style
@router.get("/bci/style")
def get_style() -> dict[str, Any]:
    _enforce()
    return get_bci_service().style()


@router.put("/bci/style")
def update_style(payload: StyleUpdate) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().save_style(payload.model_dump())
    except BciValidationError as exc:
        raise _error(exc) from exc


# ----------------------------------------------------------- conversations
@router.get("/bci/conversations")
def list_conversations(
    q: str | None = None,
    source: str | None = None,
    attention: bool = False,
) -> dict[str, Any]:
    _enforce()
    return {
        "conversations": get_bci_service().list_conversations(
            query=q, source=source, attention_only=attention
        )
    }


@router.post("/bci/conversations")
def create_conversation(payload: ConversationCreate) -> dict[str, Any]:
    _enforce()
    try:
        conversation = get_bci_service().create_conversation(
            title=payload.title,
            source=payload.source,
            messages=[item.model_dump() for item in payload.messages],
        )
    except BciValidationError as exc:
        raise _error(exc) from exc
    return {"conversation": conversation}


@router.post("/bci/conversations/delete-all")
def delete_all(payload: ConfirmRequest) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().delete_all(payload.confirm)
    except BciValidationError as exc:
        raise _error(exc) from exc


@router.get("/bci/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict[str, Any]:
    _enforce()
    try:
        return {"conversation": get_bci_service().get_conversation(conversation_id)}
    except BciNotFound as exc:
        raise _error(exc) from exc


@router.patch("/bci/conversations/{conversation_id}")
def update_conversation(conversation_id: str, payload: ConversationUpdate) -> dict[str, Any]:
    _enforce()
    try:
        conversation = get_bci_service().update_conversation(
            conversation_id,
            title=payload.title,
            retention_days=payload.retention_days,
        )
    except (BciNotFound, BciValidationError) as exc:
        raise _error(exc) from exc
    return {"conversation": conversation}


@router.delete("/bci/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().delete_conversation(conversation_id)
    except BciNotFound as exc:
        raise _error(exc) from exc


# ----------------------------------------------------------------- import
@router.post("/bci/import/preview")
def preview_import(payload: ImportRequest) -> dict[str, Any]:
    _enforce()
    try:
        return {"preview": get_bci_service().preview_import(payload.filename, payload.content)}
    except BciValidationError as exc:
        raise _error(exc) from exc


@router.post("/bci/import")
def import_conversation(payload: ImportRequest) -> dict[str, Any]:
    _enforce()
    try:
        conversation = get_bci_service().import_conversation(
            payload.filename, payload.content, title=payload.title
        )
    except BciValidationError as exc:
        raise _error(exc) from exc
    return {"conversation": conversation}


# ----------------------------------------------------------------- drafts
@router.get("/bci/conversations/{conversation_id}/drafts")
def list_drafts(conversation_id: str) -> dict[str, Any]:
    _enforce()
    try:
        conversation = get_bci_service().get_conversation(conversation_id)
    except BciNotFound as exc:
        raise _error(exc) from exc
    return {"drafts": conversation["drafts"]}


@router.post("/bci/conversations/{conversation_id}/drafts")
def create_draft(conversation_id: str, payload: DraftCreate) -> dict[str, Any]:
    _enforce()
    try:
        draft = get_bci_service().create_draft(
            conversation_id,
            text=payload.text,
            language=payload.language,
            tone=payload.tone,
        )
    except (BciNotFound, BciValidationError) as exc:
        raise _error(exc) from exc
    return {"draft": draft}


@router.patch("/bci/drafts/{draft_id}")
def update_draft(draft_id: str, payload: DraftUpdate) -> dict[str, Any]:
    _enforce()
    try:
        return {"draft": get_bci_service().update_draft(
            draft_id,
            text=payload.text,
            language=payload.language,
            tone=payload.tone,
        )}
    except (BciNotFound, BciValidationError) as exc:
        raise _error(exc) from exc


@router.delete("/bci/drafts/{draft_id}")
def delete_draft(draft_id: str) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().delete_draft(draft_id)
    except BciNotFound as exc:
        raise _error(exc) from exc


# ----------------------------------------------------------------- actions
@router.post("/bci/conversations/{conversation_id}/actions")
def run_action(conversation_id: str, payload: ActionRequest) -> dict[str, Any]:
    _enforce()
    try:
        return get_bci_service().run_action(
            conversation_id,
            payload.action,
            payload.model_dump(exclude={"action"}),
        )
    except (BciNotFound, BciValidationError, ProviderConfirmationRequired) as exc:
        raise _error(exc) from exc


__all__ = ["get_bci_service", "router"]
