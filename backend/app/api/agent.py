"""HTTP API for the computer-operation agent.

All routes are local-backend only. The agent has its own persisted switch and
starts no work until a task is submitted. Every control route maps service
failures to explicit HTTP status codes; nothing is retried behind the user's
back.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.agent.service import (
    AgentApprovalError,
    AgentDisabled,
    AgentError,
    AgentNotFound,
    AgentService,
)
from app.ai.registry import get_registry
from app.core.config import get_settings

router = APIRouter(prefix="/agent", tags=["computer-agent"])


@lru_cache(maxsize=1)
def get_agent() -> AgentService:
    settings = get_settings()
    return AgentService(settings, provider=get_registry().default())


class SettingsRequest(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)
    confirm: bool = False


class TaskRequest(BaseModel):
    task: str = Field(min_length=1, max_length=2_000)
    dry_run: bool | None = None
    allow_screenshots: bool = False
    screenshot_provider: str | None = Field(default=None, max_length=80)


class ConfirmRequest(BaseModel):
    confirm: bool = False


class RejectRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


class StepApprovalRequest(BaseModel):
    approval_id: str = Field(min_length=8, max_length=200)
    approve: bool = False


class StopRequest(BaseModel):
    reason: str = Field(default="manual", max_length=300)


class ReliabilityRequest(BaseModel):
    mode: str = Field(default="engine", pattern="^(engine|browser)$")
    runs: int = Field(default=10, ge=1, le=10)
    task: str | None = Field(default=None, max_length=2_000)


def _http_error(exc: AgentError) -> HTTPException:
    if isinstance(exc, AgentNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, AgentApprovalError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, AgentDisabled):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/status")
def agent_status() -> dict[str, Any]:
    return get_agent().status()


@router.get("/settings")
def agent_settings() -> dict[str, Any]:
    return get_agent().settings_view()


@router.post("/settings")
def update_agent_settings(payload: SettingsRequest) -> dict[str, Any]:
    try:
        return get_agent().update_settings(payload.patch, confirm=payload.confirm)
    except Exception as exc:  # noqa: BLE001 - map service failures honestly
        if isinstance(exc, AgentError):
            raise _http_error(exc) from exc
        if isinstance(exc, (ValueError, TypeError)):
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        raise


@router.post("/tasks")
def create_agent_task(payload: TaskRequest) -> dict[str, Any]:
    try:
        return get_agent().create_task(
            payload.task,
            dry_run=payload.dry_run,
            allow_screenshots=payload.allow_screenshots,
            screenshot_provider=payload.screenshot_provider,
        )
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, AgentError):
            raise _http_error(exc) from exc
        raise


@router.get("/tasks")
def list_agent_tasks(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    return {"tasks": get_agent().tasks(limit)}


@router.get("/tasks/{task_id}")
def get_agent_task(task_id: str) -> dict[str, Any]:
    try:
        return get_agent().task(task_id)
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/tasks/{task_id}/approve-plan")
def approve_agent_plan(task_id: str, payload: ConfirmRequest) -> dict[str, Any]:
    try:
        return get_agent().approve_plan(task_id, confirm=payload.confirm)
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/tasks/{task_id}/reject-plan")
def reject_agent_plan(task_id: str, payload: RejectRequest) -> dict[str, Any]:
    try:
        return get_agent().reject_plan(task_id, payload.reason)
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/tasks/{task_id}/approve-step")
def approve_agent_step(task_id: str, payload: StepApprovalRequest) -> dict[str, Any]:
    try:
        return get_agent().approve_step(task_id, payload.approval_id, payload.approve)
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/tasks/{task_id}/pause")
def pause_agent_task(task_id: str) -> dict[str, Any]:
    try:
        return get_agent().pause(task_id)
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/tasks/{task_id}/resume")
def resume_agent_task(task_id: str) -> dict[str, Any]:
    try:
        return get_agent().resume(task_id)
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/tasks/{task_id}/cancel")
def cancel_agent_task(task_id: str, payload: StopRequest) -> dict[str, Any]:
    try:
        return get_agent().cancel(task_id, payload.reason or "The user cancelled the task.")
    except AgentError as exc:
        raise _http_error(exc) from exc


@router.post("/emergency-stop")
def emergency_stop(payload: StopRequest) -> dict[str, Any]:
    return get_agent().emergency_stop(payload.reason or "manual")


@router.get("/reliability")
def agent_reliability() -> dict[str, Any]:
    return get_agent().reliability()


@router.post("/reliability/run")
def run_agent_reliability(payload: ReliabilityRequest) -> dict[str, Any]:
    try:
        return get_agent().run_reliability(mode=payload.mode, runs=payload.runs, task=payload.task)
    except Exception as exc:  # noqa: BLE001 - report the real install/test failure
        if isinstance(exc, AgentError):
            raise _http_error(exc) from exc
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/audit")
def agent_audit(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    return {"entries": get_agent().audit(limit)}
