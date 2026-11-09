"""BOZZ local persistence layer."""

from app.db.database import Database, SCHEMA_VERSION

__all__ = ["Database", "SCHEMA_VERSION"]
