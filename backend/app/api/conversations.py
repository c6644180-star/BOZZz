"""Identity-scoped persistent conversation API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.db.database import Database
from app.db.store import IntentStore
from app.identities.service import IdentityService
from app.conversations.store import ConversationNotFound, ConversationStore

router = APIRouter(tags=["conversations"])


def get_conversation_store() -> ConversationStore:
    settings = get_settings()
    database = Database(settings.database_path)
    database.initialize()
    owner_id = database.path.stem or "local_user"
    active = IdentityService(IntentStore(database)).get_active_identity(owner_id)
    identity_id = active["id"] if active else "__default__"
    return ConversationStore(database, owner_id=owner_id, identity_id=identity_id)


def _not_found(exc: ConversationNotFound) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


class CreateConversationRequest(BaseModel):
    title: str = Field(default="New conversation", max_length=120)


class RenameConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)


@router.get("/conversations")
def list_conversations(limit: int = 100) -> dict[str, Any]:
    return {"conversations": get_conversation_store().list(limit)}


@router.post("/conversations", status_code=201)
def create_conversation(payload: CreateConversationRequest) -> dict[str, Any]:
    return {"conversation": get_conversation_store().create(payload.title)}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        return {"conversation": get_conversation_store().get(conversation_id)}
    except ConversationNotFound as exc:
        raise _not_found(exc) from exc


@router.patch("/conversations/{conversation_id}")
def rename_conversation(conversation_id: str, payload: RenameConversationRequest) -> dict[str, Any]:
    try:
        return {"conversation": get_conversation_store().rename(conversation_id, payload.title)}
    except ConversationNotFound as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/conversations/{conversation_id}/export")
def export_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        return get_conversation_store().export(conversation_id)
    except ConversationNotFound as exc:
        raise _not_found(exc) from exc


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict[str, bool]:
    try:
        get_conversation_store().delete(conversation_id)
    except ConversationNotFound as exc:
        raise _not_found(exc) from exc
    return {"deleted": True}
