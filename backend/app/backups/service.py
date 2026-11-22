"""WAL-safe local SQLite backup and validated restore service."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import re
import sqlite3
import threading
import uuid
from typing import Any

from app.db.database import Database

_BACKUP_LOCK = threading.RLock()
_BACKUP_ID = re.compile(r"^(?:safety-)?[a-f0-9]{32}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class BackupValidationError(ValueError):
    """A backup is invalid, incomplete, or incompatible with BOZZ."""


class DatabaseBackupService:
    def __init__(self, database: Database, backup_dir: Path | None = None):
        self.database = database
        self.backup_dir = Path(backup_dir) if backup_dir else database.path.parent / "backups"

    def _copy_database(self, source_path: Path, target_path: Path) -> None:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if target_path.exists():
            target_path.unlink()
        source = sqlite3.connect(str(source_path), timeout=15.0)
        target = sqlite3.connect(str(target_path), timeout=15.0)
        try:
            source.execute("PRAGMA busy_timeout = 15000")
            source.backup(target)
            target.commit()
        finally:
            target.close()
            source.close()

    @staticmethod
    def _validate(path: Path) -> dict[str, Any]:
        if not path.is_file() or path.stat().st_size <= 0:
            raise BackupValidationError("Backup file is missing or empty.")
        connection = sqlite3.connect(str(path), timeout=10.0)
        try:
            try:
                result = connection.execute("PRAGMA integrity_check").fetchone()
                if not result or result[0] != "ok":
                    raise BackupValidationError("SQLite integrity check failed.")
                tables = {
                    row[0] for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if not {"schema_meta", "identities"}.issubset(tables):
                    raise BackupValidationError("This file is not a valid BOZZ database.")
                version_row = connection.execute(
                    "SELECT value FROM schema_meta WHERE key = 'version'"
                ).fetchone()
                if not version_row:
                    raise BackupValidationError("The backup has no BOZZ schema version.")
                try:
                    version = int(version_row[0])
                except (TypeError, ValueError) as exc:
                    raise BackupValidationError("The backup schema version is invalid.") from exc
                if version < 4:
                    raise BackupValidationError("The backup schema is too old to restore safely.")
                return {"schema_version": version, "tables": len(tables)}
            except sqlite3.DatabaseError as exc:
                raise BackupValidationError("The selected file is not a readable SQLite database.") from exc
        finally:
            connection.close()

    def _resolve(self, backup_id: str) -> Path:
        if not _BACKUP_ID.fullmatch(backup_id):
            raise ValueError("Invalid backup identifier.")
        path = self.backup_dir / f"{backup_id}.sqlite3"
        if not path.is_file():
            raise FileNotFoundError("Backup was not found.")
        return path

    def create_backup(self) -> dict[str, Any]:
        self.database.initialize()
        with _BACKUP_LOCK:
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            backup_id = uuid.uuid4().hex
            path = self.backup_dir / f"{backup_id}.sqlite3"
            try:
                self._copy_database(self.database.path, path)
                validation = self._validate(path)
            except Exception:
                path.unlink(missing_ok=True)
                raise
            return {
                "id": backup_id,
                "created_at": _now(),
                "size_bytes": path.stat().st_size,
                **validation,
            }

    def list_backups(self) -> list[dict[str, Any]]:
        if not self.backup_dir.exists():
            return []
        items = []
        for path in self.backup_dir.glob("*.sqlite3"):
            backup_id = path.stem
            if not _BACKUP_ID.fullmatch(backup_id):
                continue
            try:
                validation = self._validate(path)
                items.append({
                    "id": backup_id,
                    "created_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
                    "size_bytes": path.stat().st_size,
                    "safety_restore_point": backup_id.startswith("safety-"),
                    **validation,
                })
            except (OSError, sqlite3.Error, BackupValidationError):
                items.append({
                    "id": backup_id,
                    "created_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
                    "size_bytes": path.stat().st_size if path.exists() else 0,
                    "valid": False,
                    "safety_restore_point": backup_id.startswith("safety-"),
                })
        return sorted(items, key=lambda item: item["created_at"], reverse=True)

    def restore(self, backup_id: str) -> dict[str, Any]:
        source_path = self._resolve(backup_id)
        validation = self._validate(source_path)
        self.database.initialize()
        with _BACKUP_LOCK:
            safety_id = f"safety-{uuid.uuid4().hex}"
            safety_path = self.backup_dir / f"{safety_id}.sqlite3"
            temporary_path = self.database.path.with_name(f".{self.database.path.name}.{uuid.uuid4().hex}.restore")
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            self._copy_database(self.database.path, safety_path)
            try:
                self._copy_database(source_path, temporary_path)
                self._validate(temporary_path)

                # Checkpoint committed WAL pages before replacing the live database.
                current = sqlite3.connect(str(self.database.path), timeout=15.0)
                try:
                    checkpoint = current.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    if checkpoint and checkpoint[0] != 0:
                        raise RuntimeError("The database WAL could not be checkpointed; restore was cancelled.")
                finally:
                    current.close()

                wal_path = Path(f"{self.database.path}-wal")
                shm_path = Path(f"{self.database.path}-shm")
                wal_path.unlink(missing_ok=True)
                shm_path.unlink(missing_ok=True)
                os.replace(temporary_path, self.database.path)
                self.database.initialize()
            except Exception:
                temporary_path.unlink(missing_ok=True)
                # If replacement already happened, restore the safety copy.
                if safety_path.exists():
                    rollback_path = self.database.path.with_name(f".{self.database.path.name}.{uuid.uuid4().hex}.rollback")
                    try:
                        self._copy_database(safety_path, rollback_path)
                        Path(f"{self.database.path}-wal").unlink(missing_ok=True)
                        Path(f"{self.database.path}-shm").unlink(missing_ok=True)
                        os.replace(rollback_path, self.database.path)
                        self.database.initialize()
                    finally:
                        rollback_path.unlink(missing_ok=True)
                raise

            return {
                "restored": True,
                "backup_id": backup_id,
                "safety_backup_id": safety_id,
                "schema_version": validation["schema_version"],
                "message": "Database restored. A pre-restore safety backup was created.",
            }
