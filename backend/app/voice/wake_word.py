from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Any


def _configured_model_path() -> Path | None:
    raw = os.getenv("BOZZ_WAKE_WORD_MODEL", "").strip()
    return Path(raw).expanduser() if raw else None


def wake_word_model_status(*, validate: bool = False) -> dict[str, Any]:
    """Inspect an optional local ONNX model without ever opening an audio device.

    `validate=False` is a cheap status check. `validate=True` explicitly asks
    ONNX Runtime to load the configured model; it may use additional memory.
    This only verifies that the file is loadable ONNX, not that it detects the
    phrase BOZZ accurately. Accuracy evaluation and microphone capture are
    separate, future steps.
    """
    model_path = _configured_model_path()
    if model_path is None:
        return {
            "status": "not_configured",
            "configured": False,
            "file_exists": False,
            "runtime_available": False,
            "model_loadable": False,
            "model_name": None,
            "detail": "No local wake-word model is configured. No background audio is captured.",
        }

    try:
        resolved = model_path.resolve(strict=False)
    except (OSError, RuntimeError):
        resolved = model_path

    base = {
        "configured": True,
        "file_exists": resolved.is_file(),
        "runtime_available": False,
        "model_loadable": False,
        "model_name": resolved.name,
    }
    if resolved.suffix.lower() != ".onnx":
        return {
            **base,
            "status": "unsupported_format",
            "detail": "The configured model must be an ONNX (.onnx) file.",
        }
    if not resolved.is_file():
        return {
            **base,
            "status": "model_missing",
            "detail": "The configured model file was not found. No model was downloaded.",
        }

    try:
        runtime = importlib.import_module("onnxruntime")
    except (ImportError, OSError):
        return {
            **base,
            "status": "runtime_missing",
            "detail": "Optional ONNX Runtime is not installed. The default BOZZ installation is unchanged.",
        }

    base["runtime_available"] = True
    if not validate:
        return {
            **base,
            "status": "model_configured",
            "detail": "Model file and optional runtime are present. Run explicit validation before treating the engine as ready.",
        }

    try:
        session = runtime.InferenceSession(
            str(resolved), providers=["CPUExecutionProvider"]
        )
        inputs = session.get_inputs()
        if not inputs:
            raise ValueError("The ONNX model has no input tensors.")
    except Exception as exc:  # Runtime errors vary by ONNX Runtime version/provider.
        return {
            **base,
            "status": "model_invalid",
            "detail": f"ONNX Runtime could not load this model: {type(exc).__name__}.",
        }

    return {
        **base,
        "model_loadable": True,
        "status": "onnx_loadable_not_accuracy_verified",
        "detail": "ONNX Runtime loaded the model on CPU. BOZZ phrase accuracy is not verified, and no microphone was opened.",
    }
