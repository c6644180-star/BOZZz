from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.ai.base import LocalProviderError
from app.ai.registry import get_registry

# Vite owns the /api development prefix and strips it before forwarding here.
# Keep backend routes prefix-free so direct local runs and the current proxy agree.
router = APIRouter(tags=["conversation"])


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12_000)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=12)
    # Memory reaches the model only when the user granted Memory data AND turned on
    # "Use memory in chat". Sending True here never overrides either switch.
    use_memory: bool = True


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    local: bool = True


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
    history = [turn.model_dump() for turn in payload.history]
    if payload.use_memory:
        memory_message = _memory_context()
        if memory_message:
            history = [memory_message, *history[-11:]]
    try:
        reply = provider.chat(payload.message.strip(), history)
    except LocalProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatResponse(reply=reply, provider=provider.provider_name, model=provider.configured_model)
