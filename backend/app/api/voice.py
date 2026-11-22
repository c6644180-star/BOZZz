from __future__ import annotations

from fastapi import APIRouter

from app.voice.wake_word import wake_word_model_status

router = APIRouter(prefix="/voice", tags=["voice"])


@router.get("/wake-word/status")
def wake_word_status() -> dict[str, object]:
    """Cheap diagnostics only; does not load a model or access audio devices."""
    return wake_word_model_status(validate=False)


@router.post("/wake-word/validate")
def validate_wake_word_model() -> dict[str, object]:
    """Explicitly load-check the configured ONNX file; never captures audio."""
    return wake_word_model_status(validate=True)
