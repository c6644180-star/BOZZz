from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.ai.base import LocalProviderError
from app.ai.registry import get_registry
from app.api.conversations import get_conversation_store
from app.conversations.store import ConversationNotFound

# Vite owns the /api development prefix and strips it before forwarding here.
# Keep backend routes prefix-free so direct local runs and the current proxy agree.
router = APIRouter(tags=["conversation"])


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12_000)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=12)
    conversation_id: str | None = Field(default=None, min_length=1, max_length=64)
    # Memory reaches the model only when the user granted Memory data AND turned on
    # "Use memory in chat". Sending True here never overrides either switch.
    use_memory: bool = True
    persist_conversation: bool = True


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    local: bool = True
    conversation_id: str | None = None


def _memory_context() -> dict[str, str] | None:
    """Fenced memory notes, or None when the permission or the setting is off."""
    try:
        from app.api.memory import get_memory_service
        from app.api.modules import get_permissions

        if not get_permissions().is_granted("memory", "memory_data"):
            return None
        return get_memory_service().context_message()
    except Exception:  # memory must never break chat
        return None


@router.get("/ai/status")
def ai_status():
    return asdict(get_registry().default().status())


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest):
    provider = get_registry().default()
    store = get_conversation_store() if payload.persist_conversation else None
    conversation_id = payload.conversation_id
    if not payload.persist_conversation and conversation_id:
        raise HTTPException(status_code=422, detail="A non-persistent chat request cannot select a saved conversation.")
    if conversation_id and store:
        try:
            history = store.recent_history(conversation_id, limit=12)
        except ConversationNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    else:
        # Never trust browser-supplied transcript as model context. The server's
        # active identity is the source of truth for persisted conversation history.
        history = []

    if payload.use_memory:
        memory_message = _memory_context()
        if memory_message:
            history = [memory_message, *history[-11:]]
    try:
        message = payload.message.strip()
        if not message:
            raise HTTPException(status_code=422, detail="Message cannot be empty.")
        reply = provider.chat(message, history)
    except LocalProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if store:
        if not conversation_id:
            created = store.create(message[:120])
            conversation_id = created["id"]
        try:
            store.append_exchange(conversation_id, message, reply)
        except ConversationNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ChatResponse(
        reply=reply,
        provider=provider.provider_name,
        model=provider.configured_model,
        conversation_id=conversation_id,
    )
