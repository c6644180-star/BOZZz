from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.database import Database
from app.bids.service import BidService, _generate_bid, _iso_now
from app.db.store import IntentStore
from fastapi import Path as FastAPIPath

router = APIRouter(tags=["bid-management"])


def get_owner_id() -> str:
    """Derive the local user owner ID from the database path settings."""
    from app.core.config import get_settings
    settings = get_settings()
    return settings.database_path.stem or "local_user"


def _get_service() -> BidService:
    settings = get_settings()
    db = Database(settings.database_path)
    db.initialize()
    store = IntentStore(db)
    return BidService(store)


class CreateBidRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    category: str | None = Field(default=None, max_length=100)
    intended_outcome: str | None = Field(default=None, max_length=2000)


class BidResponse(BaseModel):
    bid_id: str
    owner_id: str
    title: str
    description: str
    ai_interpretation: str
    intended_outcome: str
    category: str | None
    related_project: str | None
    creation_timestamp: str
    updated_timestamp: str
    status: str
    schema_version: int
    version: int
    suggestions: list
    approved_modifications: list
    dependencies: list
    related_ideas: list
    sharing_permissions: str
    implementation_references: list
    testing_evidence: list
    original_title: str
    original_description: str


class BidListResponse(BaseModel):
    bids: list[BidResponse]
    count: int


class EditBidRequest(BaseModel):
    ai_interpretation: str | None = Field(default=None, max_length=5000)
    intended_outcome: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=100)
    related_project: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, max_length=50)
    suggestions: dict | None = Field(default=None)
    approved_modifications: dict | None = Field(default=None)
    dependencies: dict | None = Field(default=None)
    related_ideas: dict | None = Field(default=None)
    sharing_permissions: str | None = Field(default=None)
    implementation_references: dict | None = Field(default=None)
    testing_evidence: dict | None = Field(default=None)


@router.post("/bids")
def create_bid(payload: CreateBidRequest) -> dict[str, Any]:
    """Create a new BOZZ Idea (BID).

    - Idea receives a stable, collision-resistant, non-PII BID (e.g., BOZZ-ID-7F29A81C).
    - Original title and description are preserved verbatim.
    - AI interpretation starts empty; must be filled in explicitly.
    - Idea starts with status 'captured'.
    - Private sharing permission by default.
    - No automatic community publishing.
    """
    try:
        service = _get_service()
        record = service.create_bid(
            owner_id=get_owner_id(),
            title=payload.title,
            description=payload.description,
            category=payload.category,
            intended_outcome=payload.intended_outcome,
        )
        return {
            "bid_id": record["bid_id"],
            "owner_id": record["owner_id"],
            "title": record["title"],
            "description": record["description"],
            "ai_interpretation": record["ai_interpretation"],
            "intended_outcome": record["intended_outcome"],
            "category": record["category"],
            "related_project": record["related_project"],
            "creation_timestamp": record["creation_timestamp"],
            "updated_timestamp": record["updated_timestamp"],
            "status": record["status"],
            "schema_version": record["schema_version"],
            "version": record["version"],
            "suggestions": record["suggestions"],
            "approved_modifications": record["approved_modifications"],
            "dependencies": record["dependencies"],
            "related_ideas": record["related_ideas"],
            "sharing_permissions": record["sharing_permissions"],
            "implementation_references": record["implementation_references"],
            "testing_evidence": record["testing_evidence"],
            "original_title": record["original_title"],
            "original_description": record["original_description"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error creating bid")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/bids", response_model=BidListResponse)
def list_bids(
    status: str | None = Query(default=None, max_length=50),
    category: str | None = Query(default=None, max_length=100),
    project: str | None = Query(default=None, max_length=200),
) -> dict[str, Any]:
    """List BIDs with optional filtering.

    - Filters are applied with AND logic.
    - Results sorted by creation_timestamp (newest first).
    - Private ideas remain private by default.
    """
    try:
        service = _get_service()
        bids = service.list_bids(
            owner_id=get_owner_id(), status=status, category=category, project=project
        )
        return {"bids": bids, "count": len(bids)}
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error listing bids")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/bids/{bid_id}")
def get_bid(bid_id: str) -> dict[str, Any]:
    """Retrieve a specific BID by its stable identifier.

    - Returns the full BID configuration.
    - Raises 404 if the BID is not found.
    - Original title and description are always preserved.
    """
    try:
        service = _get_service()
        bid = service.get_bid(bid_id)
        if bid is None or bid["owner_id"] != get_owner_id():
            raise HTTPException(status_code=404, detail=f"BID '{bid_id}' was not found.")
        return {
            "bid_id": bid["bid_id"],
            "owner_id": bid["owner_id"],
            "title": bid["title"],
            "description": bid["description"],
            "ai_interpretation": bid["ai_interpretation"],
            "intended_outcome": bid["intended_outcome"],
            "category": bid["category"],
            "related_project": bid["related_project"],
            "creation_timestamp": bid["creation_timestamp"],
            "updated_timestamp": bid["updated_timestamp"],
            "status": bid["status"],
            "schema_version": bid["schema_version"],
            "version": bid["version"],
            "suggestions": bid["suggestions"],
            "approved_modifications": bid["approved_modifications"],
            "dependencies": bid["dependencies"],
            "related_ideas": bid["related_ideas"],
            "sharing_permissions": bid["sharing_permissions"],
            "implementation_references": bid["implementation_references"],
            "testing_evidence": bid["testing_evidence"],
            "original_title": bid["original_title"],
            "original_description": bid["original_description"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error getting bid")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.patch("/bids/{bid_id}")
def edit_bid(bid_id: str, payload: EditBidRequest) -> dict[str, Any]:
    """Edit a BID.

    - Original title and description are preserved (cannot be changed).
    - AI interpretation can be updated explicitly.
    - Version increments on any change.
    - Raises 404 if the BID is not found.
    """
    try:
        service = _get_service()
        existing = service.get_bid(bid_id)
        if existing is None or existing["owner_id"] != get_owner_id():
            raise HTTPException(status_code=404, detail=f"BID '{bid_id}' was not found.")
        record = service.edit_bid(
            bid_id,
            ai_interpretation=payload.ai_interpretation,
            intended_outcome=payload.intended_outcome,
            category=payload.category,
            related_project=payload.related_project,
            status=payload.status,
            suggestions=payload.suggestions,
            approved_modifications=payload.approved_modifications,
            dependencies=payload.dependencies,
            related_ideas=payload.related_ideas,
            sharing_permissions=payload.sharing_permissions,
            implementation_references=payload.implementation_references,
            testing_evidence=payload.testing_evidence,
        )
        return {
            "bid_id": record["bid_id"],
            "owner_id": record["owner_id"],
            "title": record["title"],
            "description": record["description"],
            "ai_interpretation": record["ai_interpretation"],
            "intended_outcome": record["intended_outcome"],
            "category": record["category"],
            "related_project": record["related_project"],
            "creation_timestamp": record["creation_timestamp"],
            "updated_timestamp": record["updated_timestamp"],
            "status": record["status"],
            "schema_version": record["schema_version"],
            "version": record["version"],
            "suggestions": record["suggestions"],
            "approved_modifications": record["approved_modifications"],
            "dependencies": record["dependencies"],
            "related_ideas": record["related_ideas"],
            "sharing_permissions": record["sharing_permissions"],
            "implementation_references": record["implementation_references"],
            "testing_evidence": record["testing_evidence"],
            "original_title": record["original_title"],
            "original_description": record["original_description"],
        }
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error editing bid")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/bids/search/description")
def search_bids_by_description(
    query: str = Query(min_length=1, max_length=500),
) -> dict[str, Any]:
    """Search BIDs by description or title.

    - Searches both title and description fields.
    - Returns matches sorted by relevance/recency.
    """
    try:
        service = _get_service()
        bids = service.search_bids(query, owner_id=get_owner_id())
        return {"bids": bids, "count": len(bids), "query": query}
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error searching bids")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/bids/search/category")
def search_bids_by_category(
    category: str = Query(min_length=1, max_length=100),
 ) -> dict[str, Any]:
    """Search BIDs by category."""
    try:
        service = _get_service()
        bids = service.search_bids_by_category(category, owner_id=get_owner_id())
        return {"bids": bids, "count": len(bids), "category": category}
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error searching bids by category")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.get("/bids/search/project")
def search_bids_by_project(
    project: str = Query(min_length=1, max_length=200),
 ) -> dict[str, Any]:
    """Search BIDs by related project."""
    try:
        service = _get_service()
        bids = service.search_bids_by_project(project, owner_id=get_owner_id())
        return {"bids": bids, "count": len(bids), "project": project}
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error searching bids by project")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/bids/{bid_id}/archive")
def archive_bid(bid_id: str) -> dict[str, Any]:
    """Archive a BID (mark as reviewed/implemented, not delete).

    - The BID data is preserved; it is removed from active lists.
    - Owner validation applies.
    - Raises 404 if the BID is not found.
    """
    try:
        service = _get_service()
        # For local single-user design, we use the database path stem as owner
        bid = service.archive_bid(bid_id, caller_owner_id=get_owner_id())
        return {
            "bid_id": bid["bid_id"],
            "title": bid["title"],
            "status": bid["status"],
            "updated_timestamp": bid["updated_timestamp"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error archiving bid")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc


@router.post("/bids/{bid_id}/delete")
def delete_bid(bid_id: str) -> dict[str, Any]:
    """Permanently delete a BID.

    - Owner validation applies.
    - Raises 404 if the BID is not found.
    - Raises 403 if the user does not own the BID.
    """
    try:
        service = _get_service()
        result = service.delete_bid(bid_id, caller_owner_id=get_owner_id())
        if result:
            return {"result": "deleted", "bid_id": bid_id}
        else:
            raise HTTPException(status_code=404, detail=f"BID '{bid_id}' not found or could not be deleted.")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger = configure_logging("INFO").getChild("bid-api")
        logger.exception("unexpected error deleting bid")
        raise HTTPException(status_code=500, detail="An unexpected local error occurred.") from exc