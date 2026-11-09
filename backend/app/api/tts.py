from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.ai.elevenlabs import (
    ElevenLabsTTS,
    TTSAuthError,
    TTSNotConfiguredError,
    TTSQuotaError,
    TTSTooLongError,
    TTSUpstreamError,
)
from app.core.config import get_settings
from app.core.logging import configure_logging

router = APIRouter(tags=["speech"])
logger = configure_logging(get_settings().log_level)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8_000)


@lru_cache(maxsize=1)
def get_tts() -> ElevenLabsTTS:
    return ElevenLabsTTS(get_settings())


@router.get("/tts/status")
def tts_status() -> dict[str, object]:
    """Report whether ElevenLabs is configured. Never includes the API key."""
    return get_tts().status()


@router.post("/tts")
def synthesize(payload: TTSRequest) -> Response:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text must not be empty.")
    try:
        audio = get_tts().synthesize(text)
    except TTSTooLongError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TTSNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TTSQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except TTSAuthError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except TTSUpstreamError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    logger.info("TTS synthesized %d bytes", len(audio))
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "X-BOZZ-TTS": "elevenlabs",
        },
    )
