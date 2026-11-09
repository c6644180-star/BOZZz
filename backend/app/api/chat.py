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


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    local: bool = True


@router.get("/ai/status")
def ai_status():
    return asdict(get_registry().default().status())


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest):
    provider = get_registry().default()
    history = [turn.model_dump() for turn in payload.history]
    try:
        reply = provider.chat(payload.message.strip(), history)
    except LocalProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatResponse(reply=reply, provider=provider.provider_name, model=provider.configured_model)
