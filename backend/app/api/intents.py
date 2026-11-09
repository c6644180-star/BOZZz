from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.database import Database
from app.db.store import IntentStore
from app.api.modules import get_permissions
from app.intent.engine import (
    ApprovalError,
    IntentEngine,
    IntentError,
    IntentNotFound,
    InvalidStateError,
)
from app.modules import PermissionDenied
from app.tools.workspace import WorkspaceTools

router = APIRouter(tags=["intent-workflow"])


@lru_cache(maxsize=1)
def get_engine() -> IntentEngine:
    settings = get_settings()
    logger = configure_logging(settings.log_level).getChild("intent")
    store = IntentStore(Database(settings.database_path))
    tools = WorkspaceTools(
        settings.workspace_dir,
        trash_dirname=settings.trash_dirname,
        max_read_bytes=settings.max_read_bytes,
        max_write_bytes=settings.max_write_bytes,
        max_search_results=settings.max_search_results,
    )
    return IntentEngine(store, tools, logger=logger)


class ProposeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4_000)
    module: str = Field(default="intent-map", max_length=80)


class ApproveRequest(BaseModel):
    approval_id: str = Field(min_length=8, max_length=200)
    confirm: bool = False


class RejectRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


def _http_error(exc: IntentError) -> HTTPException:
    if isinstance(exc, IntentNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, InvalidStateError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ApprovalError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


def _enforce(module_id: str, permissions: list[str] | None = None, intent_id: str | None = None) -> None:
    try:
        get_permissions().enforce(module_id, permissions, intent_id=intent_id)
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/intents")
def propose_intent(payload: ProposeRequest) -> dict[str, Any]:
    if payload.module == "intent-map":
        _enforce("intent-map", ["file_access"])
    try:
        return get_engine().propose(payload.text, module=payload.module)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/intents")
def list_intents(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    return {"intents": get_engine().list(limit)}


@router.get("/intents/{intent_id}")
def get_intent(intent_id: str) -> dict[str, Any]:
    try:
        return get_engine().get(intent_id)
    except IntentError as exc:
        raise _http_error(exc) from exc


@router.post("/intents/{intent_id}/approve")
def approve_intent(intent_id: str, payload: ApproveRequest) -> dict[str, Any]:
    try:
        return get_engine().approve(intent_id, payload.approval_id, payload.confirm)
    except IntentError as exc:
        raise _http_error(exc) from exc


@router.post("/intents/{intent_id}/execute")
def execute_intent(intent_id: str) -> dict[str, Any]:
    try:
        intent = get_engine().get(intent_id)
    except IntentError as exc:
        raise _http_error(exc) from exc
    if intent.get("module") == "hgi":
        raise HTTPException(
            status_code=409,
            detail=(
                "Desktop Control intents are executed only by the local desktop "
                "controller after its own approval step."
            ),
        )
    required = intent.get("required_permissions") or []
    if required:
        _enforce(intent.get("module", "intent-map"), required, intent_id)
    try:
        return get_engine().execute(intent_id)
    except IntentError as exc:
        raise _http_error(exc) from exc


@router.post("/intents/{intent_id}/reject")
def reject_intent(intent_id: str, payload: RejectRequest) -> dict[str, Any]:
    try:
        return get_engine().reject(intent_id, payload.reason)
    except IntentError as exc:
        raise _http_error(exc) from exc


@router.get("/audit")
def list_audit(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    return {"entries": get_engine().audit(limit)}


@router.get("/workspace")
def workspace_summary() -> dict[str, Any]:
    _enforce("intent-map", ["file_access"])
    return get_engine().workspace_summary()
