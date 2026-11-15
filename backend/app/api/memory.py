"""Local memory API: user-approved facts only. Nothing is learned silently."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.modules import get_permissions
from app.core.config import get_settings
from app.db.database import Database
from app.db.store import IntentStore
from app.memory import MemoryNotFound, MemoryService, MemoryStore, MemoryValidationError
from app.modules import PermissionDenied

router = APIRouter(tags=["memory"])


@lru_cache(maxsize=1)
def get_memory_service() -> MemoryService:
    settings = get_settings()
    database = Database(settings.database_path)
    return MemoryService(MemoryStore(database), IntentStore(database))


def _enforce() -> None:
    try:
        get_permissions().enforce("memory", ["memory_data"])
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, MemoryNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, MemoryValidationError):
        return HTTPException(status_code=422, detail=str(exc))
    raise exc


class FactIn(BaseModel):
    text: str = Field(min_length=1, max_length=2_000)
    source: str = Field(default="user", max_length=20)


class FactUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=2_000)


class ForgetIn(BaseModel):
    phrase: str = Field(min_length=1, max_length=200)


class ClearIn(BaseModel):
    confirm: bool = False


class SettingsIn(BaseModel):
    use_in_chat: bool


@router.get("/memory/status")
def memory_status() -> dict[str, Any]:
    service = get_memory_service()
    granted = get_permissions().is_granted("memory", "memory_data")
    return {
        "permission_granted": granted,
        "use_in_chat": service.use_in_chat() if granted else False,
        "count": service.count() if granted else None,
        "max_items": 200,
        "max_chars": 500,
        "stored_in": "Local SQLite database on this computer",
    }


@router.get("/memory/facts")
def list_facts(q: str | None = None, limit: int = 200) -> dict[str, Any]:
    _enforce()
    return {"facts": get_memory_service().list_facts(q, limit)}


@router.post("/memory/facts", status_code=201)
def add_fact(payload: FactIn) -> dict[str, Any]:
    _enforce()
    try:
        return get_memory_service().add_fact(payload.text, payload.source)
    except (MemoryValidationError, MemoryNotFound) as exc:
        raise _error(exc) from exc


@router.patch("/memory/facts/{fact_id}")
def update_fact(fact_id: str, payload: FactUpdate) -> dict[str, Any]:
    _enforce()
    try:
        return get_memory_service().update_fact(fact_id, payload.text)
    except (MemoryValidationError, MemoryNotFound) as exc:
        raise _error(exc) from exc


@router.delete("/memory/facts/{fact_id}")
def delete_fact(fact_id: str) -> dict[str, Any]:
    _enforce()
    try:
        get_memory_service().delete_fact(fact_id)
    except MemoryNotFound as exc:
        raise _error(exc) from exc
    return {"deleted": True}


@router.post("/memory/forget")
def forget(payload: ForgetIn) -> dict[str, Any]:
    _enforce()
    try:
        return {"deleted": get_memory_service().forget_matching(payload.phrase)}
    except MemoryValidationError as exc:
        raise _error(exc) from exc


@router.post("/memory/clear")
def clear(payload: ClearIn) -> dict[str, Any]:
    _enforce()
    try:
        return {"deleted": get_memory_service().clear(payload.confirm)}
    except MemoryValidationError as exc:
        raise _error(exc) from exc


@router.get("/memory/export")
def export_memory() -> dict[str, Any]:
    _enforce()
    return get_memory_service().export()


@router.post("/memory/settings")
def update_settings(payload: SettingsIn) -> dict[str, Any]:
    _enforce()
    service = get_memory_service()
    service.set_use_in_chat(payload.use_in_chat)
    return {"use_in_chat": service.use_in_chat()}
