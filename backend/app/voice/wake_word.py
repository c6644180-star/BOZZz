from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Any, Callable

from app.voice.model_runtime import configured_registry_status, resolve_active_model


def _configured_paths() -> dict[str, Path | None]:
    """Resolve explicit local model paths; registry mode never falls back to an env classifier."""
    names = {
        "wake_word": "BOZZ_WAKE_WORD_MODEL",
        "melspectrogram": "BOZZ_WAKE_WORD_MELSPEC_MODEL",
        "embedding": "BOZZ_WAKE_WORD_EMBEDDING_MODEL",
    }
    paths: dict[str, Path | None] = {
        key: Path(os.environ[name]).expanduser() if os.getenv(name, "").strip() else None
        for key, name in names.items()
    }
    registry = os.getenv("BOZZ_WAKE_WORD_REGISTRY", "").strip()
    if registry:
        try:
            active = resolve_active_model(registry)
            paths["wake_word"] = Path(active["model_path"])
        except (FileNotFoundError, ValueError, OSError):
            paths["wake_word"] = None
    return paths


def _file_report(paths: dict[str, Path | None]) -> dict[str, dict[str, Any]]:
    report: dict[str, dict[str, Any]] = {}
    for name, path in paths.items():
        report[name] = {
            "configured": path is not None,
            "exists": bool(path and path.is_file()),
            "file_name": path.name if path else None,
            "supported_format": bool(path and path.suffix.lower() == ".onnx"),
        }
    return report


def wake_word_model_status(*, validate: bool = False) -> dict[str, Any]:
    """Inspect or explicitly load-check local assets; never opens an audio device."""
    paths = _configured_paths()
    files = _file_report(paths)
    missing = [name for name, info in files.items() if not info["configured"] or not info["exists"]]
    unsupported = [name for name, info in files.items() if info["configured"] and not info["supported_format"]]
    registry = configured_registry_status()
    base: dict[str, Any] = {
        "configured": not missing,
        "files": files,
        "runtime_available": False,
        "engine_loadable": False,
        "microphone_opened": False,
        **registry,
    }
    if registry["registry_status"] == "active_model_invalid":
        return {**base, "status": "active_model_invalid", "detail": "The approved model pointer or candidate checksum is invalid. BOZZ will not fall back to another classifier."}
    if registry["registry_status"] == "no_active_model":
        return {**base, "status": "active_model_missing", "detail": "The configured model registry has no approved active candidate. Stage and explicitly activate a model first."}
    if unsupported:
        return {**base, "status": "unsupported_format", "detail": f"These assets must be ONNX files: {', '.join(unsupported)}."}
    if missing:
        return {
            **base,
            "status": "assets_missing",
            "detail": "Configure the approved BOZZ classifier and local openWakeWord melspectrogram and embedding ONNX assets. BOZZ does not download them automatically.",
        }

    try:
        importlib.import_module("onnxruntime")
        importlib.import_module("numpy")
        module = importlib.import_module("openwakeword.model")
    except (ImportError, OSError) as exc:
        return {
            **base,
            "status": "engine_dependencies_missing",
            "detail": f"Optional local wake-word dependencies are unavailable ({type(exc).__name__}).",
        }
    base["runtime_available"] = True
    if not validate:
        return {**base, "status": "assets_configured", "detail": "All local ONNX assets exist and runtime packages are importable. Run explicit validation before use."}

    try:
        model = module.Model(
            wakeword_models=[str(paths["wake_word"])],
            inference_framework="onnx",
            melspec_model_path=str(paths["melspectrogram"]),
            embedding_model_path=str(paths["embedding"]),
            ncpu=1,
        )
        if not getattr(model, "models", None):
            raise ValueError("No wake-word classifier was loaded.")
    except Exception as exc:
        return {**base, "status": "engine_invalid", "detail": f"openWakeWord could not initialize the configured assets: {type(exc).__name__}."}

    return {
        **base,
        "engine_loadable": True,
        "status": "engine_loadable_not_accuracy_verified",
        "detail": "openWakeWord loaded all assets on CPU. Phrase accuracy and false-activation rate are not verified. No microphone was opened.",
    }


class LocalWakeWordDetector:
    """Frame-in/frame-out detector with no audio-device or action-dispatch code."""

    FRAME_SAMPLES = 1280

    def __init__(self, model: Any, *, model_version: str | None = None) -> None:
        self._model = model
        self.model_version = model_version
        self._stopped = False

    @classmethod
    def load(cls, model_factory: Callable[..., Any] | None = None) -> "LocalWakeWordDetector":
        paths = _configured_paths()
        report = _file_report(paths)
        if any(not item["configured"] or not item["exists"] or not item["supported_format"] for item in report.values()):
            raise RuntimeError("All three approved/configured ONNX assets must exist before loading the local detector.")
        registry = configured_registry_status()
        if registry["registry_status"] == "active_model_invalid":
            raise RuntimeError("The approved wake-word model pointer or checksum is invalid.")
        if registry["registry_status"] == "no_active_model":
            raise RuntimeError("The configured model registry has no approved active candidate.")
        model_version = registry.get("active_version")
        if model_factory is None:
            module = importlib.import_module("openwakeword.model")
            model_factory = module.Model
        model = model_factory(
            wakeword_models=[str(paths["wake_word"])],
            inference_framework="onnx",
            melspec_model_path=str(paths["melspectrogram"]),
            embedding_model_path=str(paths["embedding"]),
            ncpu=1,
        )
        if not getattr(model, "models", None):
            raise RuntimeError("The local wake-word runtime did not load a classifier.")
        return cls(model, model_version=model_version)

    def score_frame(self, pcm_frame: Any) -> dict[str, float]:
        if self._stopped:
            raise RuntimeError("The local wake-word detector is stopped.")
        import numpy as np

        frame = np.asarray(pcm_frame)
        if frame.dtype != np.int16:
            raise ValueError("Audio frame must use signed 16-bit PCM samples.")
        if frame.ndim != 1 or frame.shape[0] != self.FRAME_SAMPLES:
            raise ValueError("Audio frame must be mono, 16 kHz, and exactly 1,280 samples (80 ms).")
        scores = self._model.predict(frame)
        return {str(name): float(score) for name, score in scores.items()}

    def reset(self) -> None:
        if self._stopped:
            raise RuntimeError("The local wake-word detector is stopped.")
        reset = getattr(self._model, "reset", None)
        if callable(reset):
            reset()

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        reset = getattr(self._model, "reset", None)
        if callable(reset):
            reset()
