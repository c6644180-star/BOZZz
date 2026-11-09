"""Real file tools confined to a BOZZ-managed workspace directory.

Every path is validated before use. Absolute paths, drive letters, UNC paths,
parent traversal, alternate data streams, and symbolic links are rejected.
Destructive operations keep a recovery copy under ``.trash`` and verification
re-reads the filesystem instead of trusting the write call.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import hashlib
import os
import re
import shutil
import uuid

_WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")


class WorkspaceError(Exception):
    """A workspace operation could not be completed safely."""


class PathEscapeError(WorkspaceError):
    """The requested path leaves the workspace sandbox."""


class NotFoundError(WorkspaceError):
    """The requested path does not exist."""


class ConflictError(WorkspaceError):
    """The requested operation conflicts with existing state."""


class TooLargeError(WorkspaceError):
    """The requested content exceeds the configured local size limit."""


class InvalidPathError(WorkspaceError):
    """The requested path is malformed or reserved."""


@dataclass(frozen=True)
class PathInfo:
    path: str
    exists: bool
    kind: str  # file | dir | symlink | other | missing
    size: int = 0
    is_symlink: bool = False


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class WorkspaceTools:
    def __init__(
        self,
        root: Path,
        *,
        trash_dirname: str = ".trash",
        max_read_bytes: int = 262_144,
        max_write_bytes: int = 262_144,
        max_search_results: int = 20,
    ):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.trash_dirname = trash_dirname
        self.trash_dir = self.root / trash_dirname
        self.max_read_bytes = max_read_bytes
        self.max_write_bytes = max_write_bytes
        self.max_search_results = max_search_results

    # ------------------------------------------------------------------ paths
    def _parts(self, relative: str) -> list[str]:
        if not isinstance(relative, str):
            raise InvalidPathError("The path must be text.")
        raw = relative.strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
            raw = raw[1:-1].strip()
        if not raw:
            return []
        if any(ch in raw for ch in ("\x00", "\n", "\r")):
            raise InvalidPathError("The path contains control characters.")
        normalized = raw.replace("\\", "/")
        if normalized.startswith("//"):
            raise PathEscapeError("Network (UNC) paths are outside the workspace.")
        if normalized.startswith("/") or normalized.startswith("~"):
            raise PathEscapeError("Absolute paths are outside the workspace.")
        if _DRIVE_PREFIX.match(normalized):
            raise PathEscapeError("Drive-letter paths are outside the workspace.")
        if ":" in normalized:
            raise InvalidPathError("Colons are not allowed in workspace paths.")
        parts = normalized.split("/")
        if any(part == ".." for part in parts):
            raise PathEscapeError("Parent traversal ('..') is not allowed.")
        parts = [part for part in parts if part not in ("", ".")]
        for part in parts:
            stem = part.split(".")[0].lower()
            if stem in _WINDOWS_RESERVED:
                raise InvalidPathError(f"'{part}' is a reserved Windows name.")
        return parts

    def check_path(self, relative: str, *, allow_root: bool = False) -> Path:
        parts = self._parts(relative)
        if not parts:
            if allow_root:
                return self.root
            raise InvalidPathError("A file or folder path is required.")
        if parts[0] == self.trash_dirname:
            raise InvalidPathError("The internal trash folder is managed by BOZZ.")
        candidate = self.root.joinpath(*parts)
        try:
            resolved = candidate.resolve(strict=False)
        except OSError as exc:
            raise InvalidPathError("The path could not be resolved.") from exc
        if not resolved.is_relative_to(self.root):
            raise PathEscapeError("The path resolves outside the workspace.")
        trash_resolved = self.trash_dir.resolve(strict=False)
        if resolved == trash_resolved or trash_resolved in resolved.parents:
            raise InvalidPathError("The internal trash folder is managed by BOZZ.")
        if candidate.is_symlink():
            raise InvalidPathError("Symbolic links are not supported in the workspace.")
        return candidate

    def relative_of(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def _trash_path(self, relative: str) -> Path:
        normalized = relative.replace("\\", "/")
        prefix = f"{self.trash_dirname}/"
        if not normalized.startswith(prefix):
            raise InvalidPathError("Only BOZZ trash paths can be inspected internally.")
        candidate = (self.root / normalized).resolve(strict=False)
        if not candidate.is_relative_to(self.trash_dir.resolve(strict=False)):
            raise PathEscapeError("The trash path resolves outside the workspace.")
        return candidate

    def inspect(self, relative: str = ".", *, allow_root: bool = True) -> PathInfo:
        path = self.check_path(relative or ".", allow_root=allow_root)
        is_link = path.is_symlink()
        if not path.exists():
            return PathInfo(path=self.relative_of(path) if path != self.root else ".", exists=False, kind="missing", is_symlink=is_link)
        if is_link:
            kind = "symlink"
        elif path.is_file():
            kind = "file"
        elif path.is_dir():
            kind = "dir"
        else:
            kind = "other"
        size = path.stat().st_size if kind == "file" else 0
        display = "." if path == self.root else self.relative_of(path)
        return PathInfo(path=display, exists=True, kind=kind, size=size, is_symlink=is_link)

    # ------------------------------------------------------------------ reads
    def list_dir(self, relative: str = ".") -> dict[str, Any]:
        path = self.check_path(relative or ".", allow_root=True)
        if not path.exists():
            raise NotFoundError(f"'{relative}' does not exist in the workspace.")
        if not path.is_dir():
            raise ConflictError(f"'{relative}' is not a folder.")
        entries: list[dict[str, Any]] = []
        for child in sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
            if child.name == self.trash_dirname or child.name.startswith(".bozz-"):
                continue
            info = self.inspect(self.relative_of(child), allow_root=False)
            entries.append({
                "name": child.name,
                "path": info.path,
                "kind": info.kind,
                "size": info.size,
                "modified": datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds"),
            })
            if len(entries) >= 500:
                break
        return {"path": self.relative_of(path) if path != self.root else ".", "count": len(entries), "entries": entries}

    def read_file(self, relative: str) -> dict[str, Any]:
        path = self.check_path(relative)
        if not path.exists():
            raise NotFoundError(f"'{relative}' does not exist in the workspace.")
        if not path.is_file():
            raise ConflictError(f"'{relative}' is not a file.")
        size = path.stat().st_size
        if size > self.max_read_bytes:
            raise TooLargeError(f"'{relative}' is larger than the {self.max_read_bytes} byte read limit.")
        data = path.read_bytes()
        if b"\x00" in data:
            raise ConflictError(f"'{relative}' is not a text file.")
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ConflictError(f"'{relative}' is not UTF-8 text.") from exc
        return {
            "path": self.relative_of(path),
            "bytes": len(data),
            "sha256": _sha256(data),
            "content": text,
        }

    def search(self, query: str, relative: str = ".") -> dict[str, Any]:
        if not query.strip():
            raise InvalidPathError("A search query is required.")
        needle = query.strip().lower()
        target = self.check_path(relative or ".", allow_root=True)
        if not target.exists():
            raise NotFoundError(f"'{relative}' does not exist in the workspace.")
        files = [target] if target.is_file() else self._text_files(target)
        matches: list[dict[str, Any]] = []
        scanned = 0
        for file_path in files:
            scanned += 1
            if len(matches) >= self.max_search_results:
                break
            try:
                if file_path.is_symlink() or file_path.stat().st_size > self.max_read_bytes:
                    continue
                data = file_path.read_bytes()
                if b"\x00" in data:
                    continue
                text = data.decode("utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for number, line in enumerate(text.splitlines(), start=1):
                if needle in line.lower():
                    matches.append({
                        "path": self.relative_of(file_path),
                        "line": number,
                        "preview": line.strip()[:240],
                    })
                    if len(matches) >= self.max_search_results:
                        break
        return {"query": query.strip(), "scanned_files": scanned, "count": len(matches), "matches": matches}

    def stats(self) -> dict[str, Any]:
        files = 0
        folders = 0
        total_bytes = 0
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [name for name in dirnames if not name.startswith(".")]
            folders += len(dirnames)
            for name in filenames:
                path = Path(dirpath) / name
                try:
                    if path.is_symlink() or not path.is_file():
                        continue
                    files += 1
                    total_bytes += path.stat().st_size
                except OSError:
                    continue
        return {"root": ".", "files": files, "folders": folders, "bytes": total_bytes}

    def _text_files(self, root: Path) -> list[Path]:
        found: list[Path] = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(
                name for name in dirnames if not name.startswith(".") and name != self.trash_dirname
            )
            for name in sorted(filenames):
                if name.startswith(".bozz-"):
                    continue
                found.append(Path(dirpath) / name)
                if len(found) >= 500:
                    return found
        return found

    # ----------------------------------------------------------------- writes
    def write_file(self, relative: str, content: str, *, overwrite: bool = False) -> dict[str, Any]:
        if not isinstance(content, str):
            raise WorkspaceError("File content must be text.")
        data = content.encode("utf-8")
        if len(data) > self.max_write_bytes:
            raise TooLargeError(f"Content exceeds the {self.max_write_bytes} byte write limit.")
        path = self.check_path(relative)
        exists = path.exists()
        if exists and not overwrite:
            raise ConflictError(f"'{relative}' already exists. Use an overwrite command to replace it.")
        if exists and not path.is_file():
            raise ConflictError(f"'{relative}' is a folder, not a file.")
        path.parent.mkdir(parents=True, exist_ok=True)
        backup = self._backup(path) if exists else None
        temp_name = path.with_name(f".bozz-{uuid.uuid4().hex[:8]}.tmp")
        try:
            with open(temp_name, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        except OSError as exc:
            try:
                temp_name.unlink(missing_ok=True)
            except OSError:
                pass
            raise WorkspaceError(f"Could not write '{relative}': {exc}") from exc
        return {
            "path": self.relative_of(path),
            "bytes_written": len(data),
            "created": not exists,
            "overwritten": exists,
            "backup": backup,
            "sha256": _sha256(data),
        }

    def append_file(self, relative: str, content: str) -> dict[str, Any]:
        if not isinstance(content, str) or not content:
            raise WorkspaceError("Appended content must be non-empty text.")
        data = content.encode("utf-8")
        path = self.check_path(relative)
        existing = 0
        if path.exists():
            if not path.is_file():
                raise ConflictError(f"'{relative}' is a folder, not a file.")
            existing = path.stat().st_size
            if b"\x00" in path.read_bytes()[:8192]:
                raise ConflictError(f"'{relative}' is not a text file.")
            if existing + len(data) > self.max_write_bytes:
                raise TooLargeError(f"The resulting file would exceed the {self.max_write_bytes} byte limit.")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(path, "ab") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:
            raise WorkspaceError(f"Could not append to '{relative}': {exc}") from exc
        final = path.read_bytes()
        return {
            "path": self.relative_of(path),
            "bytes_appended": len(data),
            "total_bytes": len(final),
            "sha256": _sha256(final),
        }

    def make_dir(self, relative: str) -> dict[str, Any]:
        path = self.check_path(relative)
        if path.exists():
            if path.is_dir():
                return {"path": self.relative_of(path), "created": False, "already_existed": True}
            raise ConflictError(f"'{relative}' already exists as a file.")
        try:
            path.mkdir(parents=True, exist_ok=False)
        except OSError as exc:
            raise WorkspaceError(f"Could not create '{relative}': {exc}") from exc
        return {"path": self.relative_of(path), "created": True, "already_existed": False}

    def move_path(self, source: str, destination: str) -> dict[str, Any]:
        src = self.check_path(source)
        dst = self.check_path(destination)
        if not src.exists():
            raise NotFoundError(f"'{source}' does not exist in the workspace.")
        if src.is_symlink() or dst.is_symlink():
            raise InvalidPathError("Symbolic links are not supported in the workspace.")
        same_path = src.resolve() == dst.resolve()
        if dst.exists() and not same_path:
            raise ConflictError(f"'{destination}' already exists.")
        if same_path and src.name == dst.name:
            raise ConflictError("The source and destination are the same path.")
        if src.is_dir() and not same_path:
            try:
                dst.relative_to(src)
                raise ConflictError("A folder cannot be moved inside itself.")
            except ValueError:
                pass
        src_rel = self.relative_of(src)
        dst_rel = self.relative_of(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(src), str(dst))
        except OSError as exc:
            raise WorkspaceError(f"Could not move '{source}': {exc}") from exc
        return {"from": src_rel, "to": dst_rel}

    def delete_path(self, relative: str) -> dict[str, Any]:
        path = self.check_path(relative)
        if path == self.root:
            raise InvalidPathError("The workspace root cannot be deleted.")
        if not path.exists():
            raise NotFoundError(f"'{relative}' does not exist in the workspace.")
        if path.is_symlink():
            raise InvalidPathError("Symbolic links are not supported in the workspace.")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        destination = self.trash_dir / stamp / path.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(path), str(destination))
        except OSError as exc:
            raise WorkspaceError(f"Could not move '{relative}' to trash: {exc}") from exc
        return {
            "path": relative,
            "trash_path": self.relative_of(destination),
            "recoverable": True,
        }

    def _backup(self, path: Path) -> str:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        destination = self.trash_dir / "overwrites" / f"{stamp}-{path.name}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(path, destination)
        except OSError as exc:
            raise WorkspaceError(f"Could not back up '{path.name}' before overwriting: {exc}") from exc
        return self.relative_of(destination)

    # ------------------------------------------------------------ verification
    def verify(self, action: dict[str, Any], result: dict[str, Any]) -> tuple[bool, str]:
        action_type = action["type"]
        try:
            if action_type == "workspace.list":
                info = self.inspect(action["target"] or ".", allow_root=True)
                return info.kind == "dir", f"Folder contains {result.get('count', 0)} entries."
            if action_type == "workspace.read":
                path = self.check_path(action["target"])
                data = path.read_bytes()
                ok = path.is_file() and _sha256(data) == result.get("sha256")
                return ok, "File re-read and hash matched." if ok else "Re-read content did not match."
            if action_type == "workspace.write":
                path = self.check_path(action["target"])
                data = path.read_bytes()
                ok = path.is_file() and _sha256(data) == result.get("sha256") and len(data) == result.get("bytes_written")
                return ok, f"File exists with {len(data)} verified bytes." if ok else "Written file did not match expected content."
            if action_type == "workspace.append":
                path = self.check_path(action["target"])
                data = path.read_bytes()
                ok = _sha256(data) == result.get("sha256")
                return ok, f"File now holds {len(data)} verified bytes." if ok else "Appended file did not match expected content."
            if action_type == "workspace.mkdir":
                path = self.check_path(action["target"])
                return path.is_dir(), "Folder exists." if path.is_dir() else "Folder is missing."
            if action_type == "workspace.move":
                src = self.check_path(action["target"])
                dst = self.check_path(action["payload"]["destination"])
                ok = dst.exists() and not src.exists()
                return ok, "Destination exists and source is gone." if ok else "Move could not be verified."
            if action_type == "workspace.delete":
                src = self.check_path(action["target"])
                trash = self._trash_path(result["trash_path"])
                ok = not src.exists() and trash.exists()
                return ok, "Source is gone and a recovery copy exists in trash." if ok else "Delete could not be verified."
            if action_type in ("workspace.search", "workspace.stats"):
                return True, f"Read-only result returned {result.get('count', result.get('files', 0))} item(s)."
        except (WorkspaceError, OSError, KeyError) as exc:
            return False, f"Verification failed: {exc}"
        return False, "No verification rule exists for this action."
