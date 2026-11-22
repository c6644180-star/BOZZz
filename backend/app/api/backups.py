"""Local database backup and restore endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.db.database import Database
from app.backups.service import BackupValidationError, DatabaseBackupService

router = APIRouter(tags=["database-backups"])


def get_backup_service() -> DatabaseBackupService:
    settings = get_settings()
    return DatabaseBackupService(Database(settings.database_path))


@router.get("/database/backups")
def list_database_backups() -> dict:
    return {"backups": get_backup_service().list_backups()}


@router.post("/database/backups", status_code=201)
def create_database_backup() -> dict:
    try:
        return {"backup": get_backup_service().create_backup()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not create a database backup.") from exc


@router.post("/database/backups/{backup_id}/restore")
def restore_database_backup(backup_id: str) -> dict:
    try:
        return get_backup_service().restore(backup_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except BackupValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Database restore failed; the previous database was preserved when possible.") from exc
