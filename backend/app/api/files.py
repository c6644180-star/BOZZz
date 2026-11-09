"""Read-only Spatial Desktop API: allowed folders, discovery, previews, open tasks."""

from __future__ import annotations

from functools import lru_cache
from typing import Any
import asyncio
import re
import threading
import uuid

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.api.modules import get_permissions
from app.core.config import get_settings
from app.db.database import Database
from app.db.store import IntentStore
from app.files.paths import PathAccessError, PathNotFound
from app.files.service import FileService, PreviewUnavailable
from app.files.store import FileStore
from app.modules import PermissionDenied

router = APIRouter(tags=["spatial-files"])

_LAYOUT_SLUG = re.compile(r"[^a-z0-9-]+")


@lru_cache(maxsize=1)
def get_file_service() -> FileService:
    settings = get_settings()
    database = Database(settings.database_path)
    return FileService(FileStore(database), IntentStore(database))


def _enforce() -> None:
    """Spatial Desktop and Holographic Projects share one read-only capability.

    Either per-module grant unlocks the same allowed-folder API. When both are
    off the denial is recorded against the older Spatial Desktop grant so the
    audit trail keeps a single, predictable target.
    """
    permissions = get_permissions()
    if permissions.is_granted("holo-projects", "file_access"):
        return
    if permissions.is_granted("spatial-desktop", "file_access"):
        return
    try:
        permissions.enforce("spatial-desktop", ["file_access"])
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDenied):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, PathNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PreviewUnavailable):
        return HTTPException(status_code=415, detail=str(exc))
    if isinstance(exc, PathAccessError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


class FolderRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4_096)


class OpenRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4_096)


class FindRequest(BaseModel):
    query: str = Field(default="", max_length=200)
    label: str | None = Field(default=None, max_length=200)
    limit: int = Field(default=10, ge=1, le=50)
    kind: str | None = Field(default=None, max_length=32)
    sort: str | None = Field(default=None, max_length=16)


class OpenApprovalRequest(BaseModel):
    approval_id: str = Field(min_length=8, max_length=200)
    confirm: bool = False


class LayoutSaveRequest(BaseModel):
    id: str | None = Field(default=None, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    cards: list[dict[str, Any]] = Field(default_factory=list)


class LayoutRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _layout_name(raw: str) -> str:
    name = (raw or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="A layout name is required.")
    return name[:120]


def _layout_slug(name: str) -> str:
    slug = _LAYOUT_SLUG.sub("-", name.casefold()).strip("-")
    return f"{slug or 'layout'}-{uuid.uuid4().hex[:8]}"


# ------------------------------------------------------------------ folders
@router.get("/files/roots")
def list_roots() -> dict[str, Any]:
    """Configured folders. Listing is allowed even when the permission is off so
    the user can always see and revoke a grant."""
    permissions = get_permissions()
    return {
        "roots": get_file_service().roots(),
        "permission_granted": permissions.is_granted("spatial-desktop", "file_access"),
        "holo_permission_granted": permissions.is_granted("holo-projects", "file_access"),
    }


@router.post("/files/roots")
def add_root(payload: FolderRequest) -> dict[str, Any]:
    _enforce()
    try:
        added = get_file_service().add_root(payload.path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc
    return {"added": added, "roots": get_file_service().roots()}


@router.delete("/files/roots")
def remove_root(path: str = Query(min_length=1, max_length=4_096)) -> dict[str, Any]:
    try:
        removed = get_file_service().remove_root(path)
    except PathAccessError as exc:
        raise _error(exc) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="That folder is not in the allowed list.")
    return {"removed": True, "roots": get_file_service().roots()}


# ---------------------------------------------------------------- discovery
@router.get("/files/list")
def list_folder(path: str = Query(min_length=1, max_length=4_096)) -> dict[str, Any]:
    _enforce()
    try:
        return get_file_service().list_dir(path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc


@router.get("/files/search")
async def search_files(
    request: Request,
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    kind: str | None = Query(default=None, max_length=32),
    sort: str | None = Query(default=None, max_length=16),
) -> dict[str, Any]:
    _enforce()
    service = get_file_service()
    cancelled = threading.Event()

    async def watch_disconnect() -> None:
        while not cancelled.is_set():
            if await request.is_disconnected():
                cancelled.set()
                return
            await asyncio.sleep(0.15)

    watcher = asyncio.create_task(watch_disconnect())
    try:
        return await run_in_threadpool(
            service.search,
            q,
            limit=limit,
            kind=kind,
            sort=sort,
            cancelled=cancelled.is_set,
        )
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc
    finally:
        cancelled.set()
        watcher.cancel()


@router.post("/files/find")
def find_files(payload: FindRequest) -> dict[str, Any]:
    """Run a read-only search as a real Intent Map task (no approval needed)."""
    _enforce()
    try:
        return get_file_service().create_find_task(
            payload.query,
            limit=payload.limit,
            kind=payload.kind,
            sort=payload.sort,
            label=payload.label,
        )
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc


@router.get("/files/preview")
def preview_file(path: str = Query(min_length=1, max_length=4_096)) -> dict[str, Any]:
    _enforce()
    try:
        return get_file_service().preview(path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc


@router.get("/files/thumbnail")
def thumbnail_file(path: str = Query(min_length=1, max_length=4_096)) -> Response:
    _enforce()
    try:
        data, digest = get_file_service().thumbnail(path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc
    return Response(
        content=data,
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=120",
            "X-Bozz-Thumbnail": digest,
        },
    )


@router.get("/files/model")
def model_bytes(path: str = Query(min_length=1, max_length=4_096)) -> Response:
    """Read-only bytes for a .glb or .gltf inside an allowed folder.

    This is a read. It does not create, change, move or delete anything.
    """
    _enforce()
    try:
        data, media_type = get_file_service().read_model(path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.get("/files/raw")
def raw_bytes(path: str = Query(min_length=1, max_length=4_096)) -> Response:
    """Read-only sidecar bytes (.bin, textures) for a glTF model.

    Executables and scripts are rejected, and the same allowed-folder checks
    apply. There is no upload or write counterpart.
    """
    _enforce()
    try:
        data, media_type = get_file_service().read_raw(path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=60"},
    )


# ------------------------------------------------------------- approved open
@router.post("/files/open")
def request_open(payload: OpenRequest) -> dict[str, Any]:
    _enforce()
    try:
        return get_file_service().create_open_task(payload.path)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc


@router.get("/files/open/{intent_id}")
def get_open_task(intent_id: str) -> dict[str, Any]:
    _enforce()
    task = get_file_service().get_open_task(intent_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Open task '{intent_id}' was not found.")
    return task


@router.post("/files/open/{intent_id}/approve")
def approve_open(intent_id: str, payload: OpenApprovalRequest) -> dict[str, Any]:
    _enforce()
    try:
        return get_file_service().approve_open(intent_id, payload.approval_id, payload.confirm)
    except (PathAccessError, OSError) as exc:
        raise _error(exc) from exc


# ---------------------------------------------------------------- layouts
@router.get("/spatial/layouts")
def list_layouts() -> dict[str, Any]:
    return {"layouts": get_file_service().list_layouts()}


@router.post("/spatial/layouts")
def save_layout(payload: LayoutSaveRequest) -> dict[str, Any]:
    name = _layout_name(payload.name)
    layout_id = payload.id or _layout_slug(name)
    try:
        layout = get_file_service().save_layout(layout_id, name, payload.cards)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"layout": layout}


@router.get("/spatial/layouts/{layout_id}")
def load_layout(layout_id: str) -> dict[str, Any]:
    layout = get_file_service().get_layout(layout_id)
    if layout is None:
        raise HTTPException(status_code=404, detail=f"Layout '{layout_id}' was not found.")
    return {"layout": layout}


@router.patch("/spatial/layouts/{layout_id}")
def rename_layout(layout_id: str, payload: LayoutRenameRequest) -> dict[str, Any]:
    layout = get_file_service().rename_layout(layout_id, _layout_name(payload.name))
    if layout is None:
        raise HTTPException(status_code=404, detail=f"Layout '{layout_id}' was not found.")
    return {"layout": layout}


@router.delete("/spatial/layouts/{layout_id}")
def delete_layout(layout_id: str) -> dict[str, Any]:
    if not get_file_service().delete_layout(layout_id):
        raise HTTPException(status_code=404, detail=f"Layout '{layout_id}' was not found.")
    return {"deleted": True, "id": layout_id}


__all__ = ["get_file_service", "router"]
