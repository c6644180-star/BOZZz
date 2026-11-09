"""Read-only file discovery, previews, and approved OS open tasks."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from app.db.store import IntentRecord, IntentStore
from app.files.paths import (
    BLOCKED_OPEN_EXTENSIONS,
    MAX_IMAGE_BYTES,
    MAX_TEXT_PREVIEW_BYTES,
    THUMBNAIL_MAX_PIXELS,
    PathAccessError,
    PathNotFound,
    classify,
    ensure_openable,
    is_openable,
    is_within,
    normalize_root,
    resolve_allowed,
    should_skip_dir,
)
from app.files.store import FileStore

SEARCH_TTL_SECONDS = 30.0
SEARCH_SCAN_LIMIT = 25_000
LIST_LIMIT = 2_000
LAYOUT_CARD_LIMIT = 500
MAX_MODEL_BYTES = 80 * 1024 * 1024
MAX_RAW_BYTES = 100 * 1024 * 1024
HOLO_EXPANDED_LIMIT = 300

_SEARCH_CACHE: dict[tuple[str, ...], tuple[float, dict[str, Any]]] = {}
_SEARCH_LOCK = threading.Lock()


class PreviewUnavailable(PathAccessError):
    pass


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _modified(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(timespec="seconds")


def _entry(path: Path) -> dict[str, Any]:
    info = path.stat()
    kind = classify(path)
    blocked = path.suffix.lower() in BLOCKED_OPEN_EXTENSIONS
    return {
        "name": path.name,
        "path": str(path),
        "type": "folder" if path.is_dir() else "file",
        "kind": kind,
        "size": 0 if path.is_dir() else info.st_size,
        "modified": _modified(info.st_mtime),
        "openable": is_openable(path),
        "blocked_reason": (
            f"{path.suffix.lower()} is an executable or script and is never opened." if blocked else None
        ),
    }


def normalize_layout_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only JSON layout facts. No file is touched and no path is opened."""
    if not isinstance(cards, list):
        raise ValueError("Layout cards must be a list.")
    if len(cards) > LAYOUT_CARD_LIMIT:
        raise ValueError(f"A layout can hold at most {LAYOUT_CARD_LIMIT} cards.")
    cleaned: list[dict[str, Any]] = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        path = card.get("path")
        card_id = card.get("id")
        if not isinstance(path, str) or not path.strip() or len(path) > 4_096:
            continue
        if not isinstance(card_id, str) or not card_id.strip():
            continue
        item: dict[str, Any] = {
            "id": card_id[:120],
            "path": path,
            "x": float(card.get("x", 40)),
            "y": float(card.get("y", 40)),
            "w": float(card.get("w", 220)),
            "h": float(card.get("h", 170)),
            "z": int(card.get("z", 1)),
        }
        group = card.get("group")
        if isinstance(group, str) and group.strip():
            item["group"] = group[:120]
        name = card.get("name")
        if isinstance(name, str) and name.strip():
            item["name"] = name[:255]
        holo = _normalize_holo(card.get("holo"))
        if holo is not None:
            item["holo"] = holo
        cleaned.append(item)
    return cleaned


def _normalize_holo(raw: Any) -> dict[str, Any] | None:
    """Keep a hologram view as JSON facts. No path is opened or changed."""
    if not isinstance(raw, dict):
        return None
    cleaned: dict[str, Any] = {}
    root = raw.get("root")
    if isinstance(root, str) and root.strip() and len(root) <= 4_096:
        cleaned["root"] = root
    expanded = raw.get("expanded")
    if isinstance(expanded, list):
        cleaned["expanded"] = [
            item[:4_096]
            for item in expanded
            if isinstance(item, str) and item.strip()
        ][:HOLO_EXPANDED_LIMIT]
    camera = raw.get("camera")

    def triple(value: Any) -> list[float] | None:
        if not isinstance(value, list) or len(value) != 3:
            return None
        if not all(isinstance(number, (int, float)) and not isinstance(number, bool) for number in value):
            return None
        return [float(number) for number in value]

    if isinstance(camera, dict):
        position = triple(camera.get("position"))
        target = triple(camera.get("target"))
        if position is not None and target is not None:
            cleaned["camera"] = {"position": position, "target": target}
    if isinstance(raw.get("filterImages"), bool):
        cleaned["filterImages"] = raw["filterImages"]
    return cleaned or None


class FileService:
    def __init__(
        self,
        store: FileStore,
        audit: IntentStore,
        *,
        clock: Callable[[], str] = _iso_now,
    ):
        self._store = store
        self._audit = audit
        self._clock = clock

    # ---------------------------------------------------------- allowed roots
    def roots(self) -> list[dict[str, Any]]:
        return self._store.list_roots()

    def root_paths(self) -> list[Path]:
        return [Path(item["path"]) for item in self.roots()]

    def add_root(self, raw: str) -> dict[str, Any]:
        path = normalize_root(raw)
        now = self._clock()
        label = path.name or str(path)
        self._store.add_root(str(path), label, now)
        self._audit.append_audit(
            intent_id=None,
            event="folder_grant",
            action_type="file_access",
            target=str(path),
            risk="high",
            outcome="granted",
            detail=f"Folder allowed for read-only Spatial Desktop access: {path}",
            created_at=now,
        )
        return {"path": str(path), "label": label, "granted_at": now}

    def remove_root(self, raw: str) -> bool:
        text = (raw or "").strip().strip('"')
        if not text or not os.path.isabs(text):
            raise PathAccessError("Provide the absolute folder path to revoke.")
        path = str(Path(os.path.realpath(text)))
        removed = self._store.remove_root(path)
        if removed:
            self._audit.append_audit(
                intent_id=None,
                event="folder_revoke",
                action_type="file_access",
                target=path,
                risk="high",
                outcome="revoked",
                detail=f"Folder access revoked: {path}",
                created_at=self._clock(),
            )
        return removed

    # ------------------------------------------------------------- discovery
    def list_dir(self, raw: str) -> dict[str, Any]:
        roots = self.root_paths()
        path = resolve_allowed(raw, roots)
        if not path.is_dir():
            raise PathAccessError(f"That path is not a folder: {path}")
        entries: list[dict[str, Any]] = []
        truncated = False
        try:
            children = list(path.iterdir())
        except OSError as exc:
            raise PathAccessError(f"The folder could not be read: {exc}") from exc
        for child in sorted(children, key=lambda item: (not item.is_dir(), item.name.casefold())):
            if len(entries) >= LIST_LIMIT:
                truncated = True
                break
            try:
                if child.is_symlink() and not any(is_within(child, root) for root in roots):
                    continue
                entries.append(_entry(child))
            except OSError:
                continue
        return {
            "path": str(path),
            "name": path.name or str(path),
            "entries": entries,
            "count": len(entries),
            "truncated": truncated,
        }

    def search(
        self,
        query: str,
        *,
        limit: int = 50,
        kind: str | None = None,
        sort: str | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        text = (query or "").strip()
        if not text and not kind and sort not in ("recent", "name"):
            raise PathAccessError("Enter a search term.")
        safe_limit = max(1, min(int(limit), 200))
        wanted = text.casefold()
        roots = self.root_paths()
        if not roots:
            raise PathAccessError("No folders are allowed yet. Add one in Settings → Permissions → File access.")
        order = sort if sort in ("recent", "name") else "name"
        key = (
            tuple(str(root) for root in roots),
            wanted,
            str(safe_limit),
            kind or "",
            order,
        )
        now = time.monotonic()
        with _SEARCH_LOCK:
            cached = _SEARCH_CACHE.get(key)
            if cached and cached[0] > now:
                return {**cached[1], "cached": True}

        matches: list[dict[str, Any]] = []
        visited = 0
        truncated = False
        was_cancelled = False
        for root in roots:
            if cancelled and cancelled():
                was_cancelled = True
                break
            for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
                if cancelled and cancelled():
                    was_cancelled = True
                    break
                kept_dirs = []
                for name in dirs:
                    full = Path(current) / name
                    if should_skip_dir(name, full):
                        continue
                    if full.is_symlink():
                        continue
                    kept_dirs.append(name)
                dirs[:] = kept_dirs
                if kind == "folder":
                    # Directory names only. This is the read-only lookup used by
                    # "open my engineering folder"; it never opens the folder.
                    for name in kept_dirs:
                        if wanted and wanted not in name.casefold():
                            continue
                        full = Path(current) / name
                        try:
                            matches.append(_entry(full))
                        except OSError:
                            continue
                visited += len(files) + len(dirs)
                if visited > SEARCH_SCAN_LIMIT:
                    truncated = True
                    break
                for name in files:
                    if wanted not in name.casefold():
                        continue
                    full = Path(current) / name
                    if full.is_symlink() and not any(is_within(full, root) for root in roots):
                        continue
                    if kind and classify(full) != kind:
                        continue
                    try:
                        item = _entry(full)
                    except OSError:
                        continue
                    matches.append(item)
                if len(matches) >= safe_limit * 8:
                    truncated = True
                    break
            if truncated or was_cancelled:
                break

        matches.sort(
            key=(
                (lambda item: item["modified"])
                if order == "recent"
                else (lambda item: (
                    0 if Path(item["name"]).stem.casefold().startswith(wanted) else 1,
                    0 if item["type"] == "folder" else 1,
                    item["name"].casefold(),
                ))
            ),
            reverse=order == "recent",
        )
        payload: dict[str, Any] = {
            "query": text,
            "kind": kind,
            "sort": order,
            "count": min(len(matches), safe_limit),
            "matches": matches[:safe_limit],
            "truncated": truncated,
            "cancelled": was_cancelled,
            "cached": False,
            "roots": [str(root) for root in roots],
        }
        if was_cancelled:
            return payload
        with _SEARCH_LOCK:
            _SEARCH_CACHE[key] = (time.monotonic() + SEARCH_TTL_SECONDS, payload)
            if len(_SEARCH_CACHE) > 32:
                _SEARCH_CACHE.pop(next(iter(_SEARCH_CACHE)))
        return payload

    # --------------------------------------------------------------- preview
    def preview(self, raw: str) -> dict[str, Any]:
        path = resolve_allowed(raw, self.root_paths())
        if path.is_dir():
            return {
                **_entry(path),
                "kind": "folder",
                "preview_kind": "icon",
                "reason": "Folder. Double-click the card to browse its contents.",
            }
        info = path.stat()
        kind = classify(path)
        payload: dict[str, Any] = {
            **_entry(path),
            "kind": kind,
            "preview_kind": kind,
        }
        if kind == "image":
            if info.st_size > MAX_IMAGE_BYTES:
                payload.update(
                    preview_kind="icon",
                    reason=f"Image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB; showing an icon.",
                )
            else:
                payload["thumbnail_url"] = f"/api/files/thumbnail?path={quote(str(path))}"
        elif kind in ("text", "markdown"):
            with path.open("rb") as handle:
                raw_bytes = handle.read(MAX_TEXT_PREVIEW_BYTES + 1)
            payload.update(
                preview_kind="text",
                text=raw_bytes[:MAX_TEXT_PREVIEW_BYTES].decode("utf-8", errors="replace"),
                truncated=len(raw_bytes) > MAX_TEXT_PREVIEW_BYTES,
                preview_limit=MAX_TEXT_PREVIEW_BYTES,
            )
        elif kind == "pdf":
            payload.update(
                preview_kind="icon",
                reason="PDF first-page preview needs PyMuPDF. It is not installed, so BOZZ shows a file icon.",
            )
        elif kind == "video":
            payload.update(preview_kind="icon", reason="Video preview is not generated; showing a video icon.")
        elif kind == "3d":
            payload.update(
                preview_kind="icon",
                reason="3D files open in the L3DME viewer; BOZZ does not render a thumbnail here.",
            )
        else:
            payload.update(preview_kind="icon", reason="No preview is available for this file type.")
        return payload

    def thumbnail(self, raw: str) -> tuple[bytes, str]:
        path = self._file(raw)
        if path.stat().st_size > MAX_IMAGE_BYTES:
            raise PathAccessError(
                f"Image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB."
            )
        if classify(path) == "pdf":
            raise PreviewUnavailable("PDF first-page rendering needs PyMuPDF, which is not installed.")
        if classify(path) != "image":
            raise PreviewUnavailable("This file type does not have an image thumbnail.")
        try:
            from PIL import Image
        except ImportError as exc:
            raise PreviewUnavailable("Image thumbnails need Pillow. Install it with: pip install Pillow") from exc

        info = path.stat()
        signature = f"{path}|{info.st_size}|{info.st_mtime_ns}|{THUMBNAIL_MAX_PIXELS}".encode()
        digest = hashlib.sha256(signature).hexdigest()
        cache_dir = Path(tempfile.gettempdir()) / "bozz-thumbs"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cached = cache_dir / f"{digest}.png"
        if cached.is_file():
            return cached.read_bytes(), digest
        try:
            with Image.open(path) as image:
                image.seek(0)
                image.thumbnail((THUMBNAIL_MAX_PIXELS, THUMBNAIL_MAX_PIXELS))
                if image.mode not in ("RGB", "RGBA"):
                    image = image.convert("RGBA")
                image.save(cached, format="PNG", optimize=True)
        except OSError as exc:
            raise PathAccessError(f"The image could not be read: {exc}") from exc
        return cached.read_bytes(), digest

    # -------------------------------------------------------- read-only models
    def read_model(self, raw: str) -> tuple[bytes, str]:
        path = self._file(raw)
        suffix = path.suffix.lower()
        if suffix not in (".glb", ".gltf"):
            raise PathAccessError(
                "The hologram model viewer reads only .glb and .gltf files. "
                f"{suffix or 'No extension'} is not a supported model format."
            )
        size = path.stat().st_size
        if size > MAX_MODEL_BYTES:
            raise PathAccessError(
                f"The model is {size // (1024 * 1024)} MB; the read limit is "
                f"{MAX_MODEL_BYTES // (1024 * 1024)} MB."
            )
        data = path.read_bytes()
        self._audit.append_audit(
            intent_id=None,
            event="file_read",
            action_type="spatial.model",
            target=str(path),
            risk="low",
            outcome="ok",
            detail=f"Read {len(data)} model byte(s) for the read-only hologram viewer. Nothing was changed.",
            created_at=self._clock(),
        )
        media = "model/gltf-binary" if suffix == ".glb" else "model/gltf+json"
        return data, media

    def read_raw(self, raw: str) -> tuple[bytes, str]:
        path = self._file(raw)
        suffix = path.suffix.lower()
        if suffix in BLOCKED_OPEN_EXTENSIONS:
            raise PathAccessError(
                f'BOZZ will not read "{path.name}" as a model resource: '
                f"{suffix} files are executables or scripts."
            )
        size = path.stat().st_size
        if size > MAX_RAW_BYTES:
            raise PathAccessError(
                f"The resource is {size // (1024 * 1024)} MB; the read limit is "
                f"{MAX_RAW_BYTES // (1024 * 1024)} MB."
            )
        data = path.read_bytes()
        media = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self._audit.append_audit(
            intent_id=None,
            event="file_read",
            action_type="spatial.resource",
            target=str(path),
            risk="low",
            outcome="ok",
            detail=f"Read {len(data)} sidecar byte(s) for a glTF model. Nothing was changed.",
            created_at=self._clock(),
        )
        return data, media

    # ------------------------------------------------------------- approved open
    def create_find_task(
        self,
        query: str,
        *,
        limit: int = 10,
        kind: str | None = None,
        sort: str | None = None,
        label: str | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        """Run a read-only search as a real Intent Map task with filesystem evidence."""
        now = self._clock()
        intent_id = uuid.uuid4().hex
        roots = self.root_paths()
        display = (label or query or f"latest {kind or 'file'}").strip()
        action = {
            "type": "spatial.search",
            "target": display,
            "description": f'Search {len(roots)} allowed folder(s) for "{display}". No file is opened or changed.',
            "preview": f"read-only search in {len(roots)} folder(s)",
            "risk": "low",
            "reversible": True,
        }
        plan = {
            "actions": [action],
            "warnings": ["Search reads folder and file names only; file contents are not read."],
            "examples": [],
            "approval_required": False,
            "module": "spatial-desktop",
            "required_permissions": ["file_access"],
        }
        steps = {
            "UNDERSTAND": ("done", f'Recognised a search for "{display}".'),
            "PLAN": ("done", f"Read-only search across {len(roots)} allowed folder(s)."),
            "APPROVE": ("skipped", "Read-only search; explicit approval is not required and nothing is changed."),
            "EXECUTE": ("pending", "Not started."),
            "VERIFY": ("pending", "Not started."),
            "REPORT": ("pending", "Not started."),
        }
        record = IntentRecord(
            id=intent_id,
            raw_text=f"find {display}",
            status="approved",
            plan_json=json.dumps(plan, ensure_ascii=False),
            approval_id=None,
            approval_required=False,
            created_at=now,
            updated_at=now,
        )
        self._insert_task(record, steps, now)

        try:
            result = self.search(query, limit=limit, kind=kind, sort=sort, cancelled=cancelled)
        except PathAccessError as exc:
            failed = self._clock()
            self._audit.append_step(intent_id, "EXECUTE", "error", str(exc), failed)
            self._audit.append_step(intent_id, "VERIFY", "skipped", "No search results to verify.", failed)
            summary = f"Search did not run. {exc}"
            self._audit.append_step(intent_id, "REPORT", "error", summary, failed)
            report = {
                "summary": summary,
                "actions": [{"index": 1, "type": "spatial.search", "target": display, "ok": False, "detail": str(exc)}],
                "verification": [],
                "finished_at": failed,
                "done_allowed": False,
            }
            self._audit.update_intent(intent_id, "failed", failed, json.dumps(report, ensure_ascii=False))
            self._audit.append_audit(
                intent_id=intent_id,
                event="search",
                action_type="spatial.search",
                target=query,
                risk="low",
                outcome="error",
                detail=summary,
                created_at=failed,
            )
            stored = self._audit.get_intent(intent_id)
            payload = self.task_view(stored) if stored else {}
            return {**payload, "matches": [], "search": None}

        confirmed: list[dict[str, Any]] = []
        for match in result["matches"]:
            candidate = Path(match["path"])
            try:
                if candidate.exists() and any(is_within(candidate, root) for root in roots):
                    confirmed.append(match)
            except OSError:
                continue

        finished = self._clock()
        executed = (
            f'Search scanned {len(roots)} allowed folder(s) and returned {len(confirmed)} confirmed match(es).'
        )
        evidence_detail = (
            f"{len(confirmed)} match(es) exist inside {len(roots)} allowed folder(s). "
            "Folder and file names were read; no file contents were opened."
        )
        if result.get("truncated"):
            evidence_detail += " The scan stopped at the safety limit; more matches may exist."
        self._audit.append_step(intent_id, "EXECUTE", "done", executed, finished)
        self._audit.append_step(intent_id, "VERIFY", "done", evidence_detail, finished)
        summary = (
            f'Found {len(confirmed)} file(s) matching "{query.strip()}".'
            if confirmed
            else f'No files matching "{query.strip()}" were found in the allowed folders.'
        )
        self._audit.append_step(intent_id, "REPORT", "done", summary, finished)
        report = {
            "summary": summary,
            "actions": [
                {
                    "index": 1,
                    "type": "spatial.search",
                    "target": display,
                    "ok": True,
                    "detail": executed,
                }
            ],
            "verification": [
                {"action": 1, "ok": True, "detail": evidence_detail, "source": "filesystem"}
            ],
            "finished_at": finished,
            "done_allowed": True,
        }
        self._audit.update_intent(intent_id, "reported", finished, json.dumps(report, ensure_ascii=False))
        self._audit.append_audit(
            intent_id=intent_id,
            event="search",
            action_type="spatial.search",
            target=display,
            risk="low",
            outcome="ok",
            detail=summary,
            created_at=finished,
        )
        stored = self._audit.get_intent(intent_id)
        payload = self.task_view(stored) if stored else {}
        return {**payload, "matches": confirmed, "search": result}

    def create_open_task(self, raw: str) -> dict[str, Any]:
        roots = self.root_paths()
        path = resolve_allowed(raw, roots)
        ensure_openable(path)
        now = self._clock()
        intent_id = uuid.uuid4().hex
        approval_id = secrets.token_urlsafe(24)
        action = {
            "type": "spatial.open",
            "target": str(path),
            "description": f'Ask the operating system to open "{path.name}" with its default application.',
            "preview": f"{path}",
            "risk": "medium",
            "reversible": True,
        }
        plan = {
            "actions": [action],
            "warnings": [
                "BOZZ can confirm the file exists and that the OS accepted the request, but not what the application does."
            ],
            "examples": [],
            "approval_required": True,
            "module": "spatial-desktop",
            "required_permissions": ["file_access"],
        }
        steps = {
            "UNDERSTAND": ("done", f"Recognised a request to open an allowed file: {path.name}."),
            "PLAN": ("done", "One OS open action planned. No file content is changed."),
            "APPROVE": ("pending", "Waiting for explicit approval."),
            "EXECUTE": ("pending", "Not started."),
            "VERIFY": ("pending", "Not started."),
            "REPORT": ("pending", "Not started."),
        }
        record = IntentRecord(
            id=intent_id,
            raw_text=f"open {path.name}",
            status="awaiting_approval",
            plan_json=json.dumps(plan, ensure_ascii=False),
            approval_id=approval_id,
            approval_required=True,
            created_at=now,
            updated_at=now,
        )
        self._store_audit_open(record, "open_request", "awaiting_approval", f"Open requested for {path}", now)
        self._insert_task(record, steps, now)
        stored = self._audit.get_intent(intent_id)
        return self.task_view(stored) if stored else {}

    def approve_open(self, intent_id: str, approval_id: str, confirm: bool) -> dict[str, Any]:
        record = self._audit.get_intent(intent_id)
        if record is None:
            raise PathNotFound(f"Open task '{intent_id}' was not found.")
        if record["status"] != "awaiting_approval":
            raise PathAccessError(f"Open task is '{record['status']}', not awaiting approval.")
        if not confirm:
            raise PathAccessError("Approval must be explicitly confirmed.")
        expected = record.get("approval_id") or ""
        if not expected or not hmac.compare_digest(str(expected), str(approval_id)):
            raise PathAccessError("The approval challenge does not match this task.")

        now = self._clock()
        self._audit.append_step(intent_id, "APPROVE", "done", "Approved by the user.", now)
        self._audit.append_audit(
            intent_id=intent_id,
            event="approve",
            action_type="spatial.open",
            target=json.loads(record["plan_json"])["actions"][0]["target"],
            risk="medium",
            outcome="approved",
            detail="Explicit user approval recorded for the OS open.",
            created_at=now,
        )

        target: Path | None = None
        error: str | None = None
        try:
            plan = json.loads(record["plan_json"])
            target = resolve_allowed(plan["actions"][0]["target"], self.root_paths())
            ensure_openable(target)
            self._open_with_os(target)
        except (PathAccessError, OSError) as exc:
            error = str(exc)

        if error or target is None:
            failed_at = self._clock()
            self._audit.append_step(intent_id, "EXECUTE", "error", f"The OS open was not started: {error}", failed_at)
            self._audit.append_step(intent_id, "VERIFY", "skipped", "Nothing was opened, so there is nothing to verify.", failed_at)
            summary = f"Open failed. {error} The file was not changed."
            report = {
                "summary": summary,
                "actions": [{"index": 1, "type": "spatial.open", "target": "", "ok": False, "detail": error or "Unknown error"}],
                "verification": [],
                "finished_at": failed_at,
                "done_allowed": False,
            }
            self._audit.append_step(intent_id, "REPORT", "error", summary, failed_at)
            self._audit.update_intent(intent_id, "failed", failed_at, json.dumps(report, ensure_ascii=False))
            self._store_audit_open(record, "open", "error", summary, failed_at)
            stored = self._audit.get_intent(intent_id)
            return self.task_view(stored) if stored else {}

        finished = self._clock()
        try:
            present = target.is_file()
            detail = (
                f'File "{target.name}" is present and the OS accepted the open request. '
                "BOZZ cannot confirm the application window."
            )
        except OSError as exc:
            present = False
            detail = f"File check failed after the open request: {exc}"
        self._audit.append_step(intent_id, "EXECUTE", "done", "The OS open request was accepted.", finished)
        self._audit.append_step(
            intent_id, "VERIFY", "done" if present else "error", detail, finished
        )
        summary = (
            f'OS open requested for "{target.name}" and the file is still present. Nothing was changed.'
            if present
            else f'OS open requested for "{target.name}", but the follow-up file check failed.'
        )
        report = {
            "summary": summary,
            "actions": [
                {
                    "index": 1,
                    "type": "spatial.open",
                    "target": str(target),
                    "ok": present,
                    "detail": detail,
                }
            ],
            "verification": [
                {
                    "action": 1,
                    "ok": present,
                    "detail": detail,
                    "source": "filesystem",
                }
            ],
            "finished_at": finished,
            "done_allowed": present,
        }
        status = "reported" if present else "failed"
        self._audit.append_step(intent_id, "REPORT", "done" if present else "error", summary, finished)
        self._audit.update_intent(intent_id, status, finished, json.dumps(report, ensure_ascii=False))
        self._store_audit_open(record, "open", "ok" if present else "error", summary, finished)
        stored = self._audit.get_intent(intent_id)
        return self.task_view(stored) if stored else {}

    def _open_with_os(self, path: Path) -> None:
        if os.name == "nt":
            os.startfile(str(path))  # type: ignore[attr-defined]
            return
        command = ["open", str(path)] if sys.platform == "darwin" else ["xdg-open", str(path)]
        subprocess.Popen(  # noqa: S603 - fixed local opener, no shell
            command,
            shell=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def get_open_task(self, intent_id: str) -> dict[str, Any] | None:
        record = self._audit.get_intent(intent_id)
        return self.task_view(record) if record else None

    # ---------------------------------------------------------------- layouts
    def list_layouts(self) -> list[dict[str, Any]]:
        return self._store.list_layouts()

    def get_layout(self, layout_id: str) -> dict[str, Any] | None:
        return self._store.get_layout(layout_id)

    def save_layout(
        self,
        layout_id: str,
        name: str,
        cards: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        cleaned = normalize_layout_cards(cards)
        existing = self._store.get_layout(layout_id)
        now = self._clock()
        self._store.save_layout(
            layout_id,
            name,
            cleaned,
            existing["created_at"] if existing else now,
            now,
            replace=existing is not None,
        )
        return self._store.get_layout(layout_id)

    def rename_layout(self, layout_id: str, name: str) -> dict[str, Any] | None:
        if not self._store.rename_layout(layout_id, name, self._clock()):
            return None
        return self._store.get_layout(layout_id)

    def delete_layout(self, layout_id: str) -> bool:
        return self._store.delete_layout(layout_id)

    def _file(self, raw: str) -> Path:
        path = resolve_allowed(raw, self.root_paths())
        if not path.is_file():
            raise PathAccessError(f"That path is not a file: {path}")
        return path

    # ---------------------------------------------------------------- helpers
    def _insert_task(
        self,
        record: IntentRecord,
        steps: dict[str, tuple[str, str]],
        now: str,
    ) -> None:
        self._audit.create_intent(record)
        for step in ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT"):
            status, detail = steps[step]
            self._audit.append_step(record.id, step, status, detail, now)

    def _store_audit_open(
        self,
        record: IntentRecord | dict[str, Any],
        event: str,
        outcome: str,
        detail: str,
        created_at: str,
    ) -> None:
        if isinstance(record, IntentRecord):
            intent_id = record.id
            plan_json = record.plan_json
        else:
            intent_id = record["id"]
            plan_json = record["plan_json"]
        try:
            target = json.loads(plan_json)["actions"][0]["target"]
        except (KeyError, json.JSONDecodeError, IndexError, TypeError):
            target = None
        self._audit.append_audit(
            intent_id=intent_id,
            event=event,
            action_type="spatial.open",
            target=target,
            risk="medium",
            outcome=outcome,
            detail=detail,
            created_at=created_at,
        )

    def task_view(self, record: dict[str, Any]) -> dict[str, Any]:
        plan = json.loads(record["plan_json"])
        report = json.loads(record["report_json"]) if record.get("report_json") else None
        latest: dict[str, dict[str, Any]] = {}
        for row in self._audit.list_steps(record["id"]):
            latest[row["step"]] = {
                "step": row["step"],
                "status": row["status"],
                "detail": row["detail"],
                "at": row["created_at"],
            }
        steps = [
            latest.get(step, {"step": step, "status": "pending", "detail": "Not started.", "at": None})
            for step in ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT")
        ]
        evidence = report.get("verification", []) if isinstance(report, dict) else []
        evidence = [dict(item) for item in evidence] if isinstance(evidence, list) else []
        errors = [
            {"stage": step["step"], "detail": step["detail"]}
            for step in steps
            if step["status"] in ("error", "blocked") and str(step["detail"]).strip()
        ]
        approval_requested = bool(record.get("approval_required", 1))
        approval_state = "not_requested" if not approval_requested else {
            "awaiting_approval": "pending",
            "approved": "approved",
            "reported": "approved",
            "rejected": "rejected",
            "failed": "approved",
        }.get(record["status"], "not_requested")
        done_allowed = record["status"] == "reported" and bool(evidence) and all(
            item.get("ok") is True for item in evidence
        )
        task = {
            "id": record["id"],
            "module": "spatial-desktop",
            "stages": steps,
            "required_permissions": plan.get("required_permissions", ["file_access"]),
            "approval_state": approval_state,
            "errors": errors,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
        }
        return {
            "id": record["id"],
            "text": record["raw_text"],
            "status": record["status"],
            "understood": True,
            "approval_required": approval_requested,
            "approval_id": record.get("approval_id"),
            "module": "spatial-desktop",
            "required_permissions": task["required_permissions"],
            "approval_state": approval_state,
            "errors": errors,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
            "task": task,
            "message": (report or {}).get("summary", "Waiting for explicit approval."),
            "warnings": plan.get("warnings", []),
            "examples": [],
            "actions": [
                {key: value for key, value in action.items() if key != "payload"}
                for action in plan.get("actions", [])
            ],
            "steps": steps,
            "report": report,
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }


__all__ = [
    "FileService",
    "PreviewUnavailable",
    "SEARCH_TTL_SECONDS",
    "normalize_layout_cards",
]
