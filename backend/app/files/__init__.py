"""Read-only Spatial Desktop file services."""

from app.files.service import FileService, PreviewUnavailable
from app.files.store import FileStore

__all__ = ["FileService", "FileStore", "PreviewUnavailable"]
