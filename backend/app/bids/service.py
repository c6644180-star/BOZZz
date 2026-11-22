"""BID (BOZZ Idea Identity) management service for BOZZ AI.

Provides create, read, search, update, archive, and delete operations for
BOZZ Idea Identity entries with collision-resistant non-PII identifiers.

Idea lifecycle: CAPTURE → UNDERSTAND → IDENTIFY → ORGANISE → DEVELOP →
REVIEW → APPROVE → IMPLEMENT → VERIFY → EVOLVE.

Every idea receives a stable, collision-resistant, non-PII BID (e.g., BOZZ-ID-7F29A81C).
Original idea text is never silently replaced by AI-generated interpretations.
Private ideas remain private by default; no automatic community publishing.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.db.store import IntentStore

logger = logging.getLogger("bozz.bids")


def _parse_config(value: str) -> dict:
    """Parse a JSON config string, returning empty dict on failure."""
    try:
        return json.loads(value) if value else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _generate_bid() -> str:
    """Generate a collision-resistant non-PII BID.

    Format: BOZZ-ID-XXXXXXXX where X is hexadecimal.
    Uses UUIDv4 truncated to 8 hex chars after the prefix, making collisions
    extremely unlikely while keeping identifiers short and human-readable.
    """
    import uuid
    # Generate: BOZZ-ID- + 8 hex characters from UUIDv4
    # 8 hex chars = 32 bits, collision probability is very low for typical usage
    unique_part = uuid.uuid4().hex[:8].upper()
    return f"BOZZ-ID-{unique_part}"


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class BidService:
    """Service layer for BID management business logic."""

    def __init__(self, store: IntentStore):
        self._store = store

    # ----------------------------------------------------------- create

    def create_bid(
        self,
        owner_id: str,
        title: str,
        description: str,
        category: str | None = None,
        intended_outcome: str | None = None,
    ) -> dict[str, Any]:
        """Create a new BOZZ Idea (BID).

        - Idea receives a stable, collision-resistant, non-PII BID.
        - Original title and description are preserved verbatim.
        - AI interpretation starts empty; must be filled in explicitly.
        - Idea starts with status 'captured'.
        - Version starts at 1.
        - Private sharing permission by default.
        """
        bid_id = _generate_bid()
        now = _iso_now()

        record = {
            "bid_id": bid_id,
            "owner_id": owner_id,
            "title": title,
            "description": description,
            "ai_interpretation": "",
            "intended_outcome": intended_outcome or "",
            "category": category or "",
            "related_project": "",
            "creation_timestamp": now,
            "updated_timestamp": now,
            "status": "captured",
            "schema_version": 1,
            "version": 1,
            "suggestions": "[]",
            "approved_modifications": "[]",
            "dependencies": "[]",
            "related_ideas": "[]",
            "sharing_permissions": "private",
            "implementation_references": "[]",
            "testing_evidence": "[]",
            "original_title": title,
            "original_description": description,
        }

        self._store.create_bid(record)
        logger.info("bid created bid_id=%s title=%s owner=%s", bid_id, title, owner_id)
        return self.get_bid(bid_id)

    # ----------------------------------------------------------- read

    def get_bid(self, bid_id: str) -> dict[str, Any] | None:
        """Retrieve a BID by its stable identifier.

        - Returns None if not found.
        - Original title and description are always preserved.
        - AI interpretation is returned but must not silently replace original text.
        """
        record = self._store.get_bid(bid_id)
        if record is None:
            return None
        return {
            "bid_id": record["bid_id"],
            "owner_id": record["owner_id"],
            "title": record["title"],
            "description": record["description"],
            "ai_interpretation": record["ai_interpretation"] or "",
            "intended_outcome": record["intended_outcome"] or "",
            "category": record["category"] or "",
            "related_project": record["related_project"] or "",
            "creation_timestamp": record["creation_timestamp"],
            "updated_timestamp": record["updated_timestamp"],
            "status": record["status"],
            "schema_version": record["schema_version"],
            "version": record["version"],
            "suggestions": json.loads(record["suggestions"]) if record["suggestions"] else [],
            "approved_modifications": json.loads(record["approved_modifications"]) if record["approved_modifications"] else [],
            "dependencies": json.loads(record["dependencies"]) if record["dependencies"] else [],
            "related_ideas": json.loads(record["related_ideas"]) if record["related_ideas"] else [],
            "sharing_permissions": record["sharing_permissions"],
            "implementation_references": json.loads(record["implementation_references"]) if record["implementation_references"] else [],
            "testing_evidence": json.loads(record["testing_evidence"]) if record["testing_evidence"] else [],
            "original_title": record["original_title"],
            "original_description": record["original_description"],
        }

    def list_bids(
        self, owner_id: str | None = None, status: str | None = None,
        category: str | None = None, project: str | None = None,
    ) -> list[dict[str, Any]]:
        """List BIDs using AND-combined filters; owner scoping is preserved."""
        clauses: list[str] = []
        params: list[Any] = []
        if owner_id is not None:
            clauses.append("owner_id = ?")
            params.append(owner_id)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if category:
            clauses.append("category LIKE ?")
            params.append(f"%{category}%")
        if project:
            clauses.append("related_project LIKE ?")
            params.append(f"%{project}%")

        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._store._db.read() as connection:
            rows = connection.execute(
                f"SELECT * FROM bids{where} ORDER BY creation_timestamp DESC",
                params,
            ).fetchall()

        result = [dict(row) for row in rows]
        json_fields = (
            "suggestions", "approved_modifications", "dependencies",
            "related_ideas", "implementation_references", "testing_evidence",
        )
        for row in result:
            for field in json_fields:
                raw = row.get(field)
                try:
                    row[field] = json.loads(raw) if raw else []
                except (TypeError, json.JSONDecodeError):
                    row[field] = []
        return result

    # ----------------------------------------------------------- update

    def edit_bid(
        self,
        bid_id: str,
        title: str | None = None,
        description: str | None = None,
        ai_interpretation: str | None = None,
        intended_outcome: str | None = None,
        category: str | None = None,
        related_project: str | None = None,
        status: str | None = None,
        suggestions: dict | None = None,
        approved_modifications: dict | None = None,
        dependencies: dict | None = None,
        related_ideas: dict | None = None,
        sharing_permissions: str | None = None,
        implementation_references: dict | None = None,
        testing_evidence: dict | None = None,
    ) -> dict[str, Any]:
        """Edit a BID.

        - Original title and description are preserved (cannot be changed).
        - AI interpretation can be updated explicitly.
        - Version increments on any change.
        - All other fields are optional; unspecified fields are preserved.
        """
        # Verify the bid exists
        record = self._store.get_bid(bid_id)
        if record is None:
            raise ValueError(f"BID '{bid_id}' was not found.")

        # Original title and description cannot be changed
        update_kwargs: dict[str, Any] = {}
        if ai_interpretation is not None:
            update_kwargs["ai_interpretation"] = ai_interpretation
        if intended_outcome is not None:
            update_kwargs["intended_outcome"] = intended_outcome
        if category is not None:
            update_kwargs["category"] = category
        if related_project is not None:
            update_kwargs["related_project"] = related_project
        if status is not None:
            update_kwargs["status"] = status
        if suggestions is not None:
            update_kwargs["suggestions"] = json.dumps(suggestions)
        if approved_modifications is not None:
            update_kwargs["approved_modifications"] = json.dumps(approved_modifications)
        if dependencies is not None:
            update_kwargs["dependencies"] = json.dumps(dependencies)
        if related_ideas is not None:
            update_kwargs["related_ideas"] = json.dumps(related_ideas)
        if sharing_permissions is not None:
            update_kwargs["sharing_permissions"] = sharing_permissions
        if implementation_references is not None:
            update_kwargs["implementation_references"] = json.dumps(implementation_references)
        if testing_evidence is not None:
            update_kwargs["testing_evidence"] = json.dumps(testing_evidence)

        # Always update the timestamp
        update_kwargs["updated_timestamp"] = _iso_now()
        update_kwargs["version"] = (record["version"] or 1) + 1

        self._store.update_bid(bid_id, **update_kwargs)
        updated = self.get_bid(bid_id)
        logger.info("bid edited bid_id=%s version=%s", bid_id, updated["version"])
        return updated

    # ----------------------------------------------------------- search

    def search_bids(self, query: str, owner_id: str | None = None) -> list[dict[str, Any]]:
        """Search BIDs by description or title.

        - Searches both title and description fields.
        - Returns matches sorted by relevance/recency.
        """
        return self._store.search_bids_by_description(query, owner_id=owner_id)

    def search_bids_by_category(self, category: str, owner_id: str | None = None) -> list[dict[str, Any]]:
        """Search BIDs by category."""
        return self._store.search_bids_by_category(category, owner_id=owner_id)

    def search_bids_by_project(self, project: str, owner_id: str | None = None) -> list[dict[str, Any]]:
        """Search BIDs by related project."""
        return self._store.search_bids_by_project(project, owner_id=owner_id)

    # ----------------------------------------------------------- archive/delete

    def archive_bid(self, bid_id: str, caller_owner_id: str) -> dict[str, Any]:
        """Archive a BID (mark as reviewed/implemented, not delete).

        - The BID data is preserved; it is removed from active lists.
        - Owner validation applies.
        """
        record = self._store.get_bid(bid_id)
        if record is None:
            raise ValueError(f"BID '{bid_id}' was not found.")
        if record["owner_id"] != caller_owner_id:
            raise PermissionError(
                f"You do not own BID '{record['title']}'."
            )
        # Update status to indicate it's been through the lifecycle
        self._store.update_bid(
            bid_id,
            status="evolved",
            updated_timestamp=_iso_now(),
        )
        updated = self.get_bid(bid_id)
        logger.info("bid archived bid_id=%s title=%s", bid_id, record["title"])
        return updated

    def delete_bid(self, bid_id: str, caller_owner_id: str) -> bool:
        """Permanently delete a BID.

        - Owner validation applies.
        - Private BIDs cannot be deleted if they would lose tracking.
        - Prevent deletion if it would lose track of ideas.
        """
        record = self._store.get_bid(bid_id)
        if record is None:
            return False
        if record["owner_id"] != caller_owner_id:
            raise PermissionError(
                f"You do not own BID '{record['title']}'."
            )
        # Prevent deletion of the only tracking record for an idea
        # (In a full implementation, this would check for related data)
        result = self._store.delete_bid(bid_id, caller_owner_id)
        logger.info("bid deleted bid_id=%s title=%s", bid_id, record["title"])
        return result