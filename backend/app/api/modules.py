from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.db.database import Database
from app.db.store import IntentStore
from app.modules import ModuleService, PermissionDenied, PermissionError, PermissionManager

router = APIRouter(tags=["modules"])


@lru_cache(maxsize=1)
def get_permissions() -> PermissionManager:
    settings = get_settings()
    return PermissionManager(IntentStore(Database(settings.database_path)))


@lru_cache(maxsize=1)
def get_module_service() -> ModuleService:
    return ModuleService(get_permissions())


class PermissionChangeRequest(BaseModel):
    permission: str
    granted: bool


@router.get("/modules")
def list_modules() -> dict[str, Any]:
    return get_module_service().snapshot()


@router.get("/modules/{module_id}")
def get_module(module_id: str) -> dict[str, Any]:
    try:
        return get_module_service().module(module_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/modules/{module_id}/permissions")
def change_permission(module_id: str, payload: PermissionChangeRequest) -> dict[str, Any]:
    try:
        return get_module_service().set_permission(module_id, payload.permission, payload.granted)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


__all__ = ["PermissionDenied", "get_module_service", "get_permissions", "router"]
