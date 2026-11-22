from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from app.voice.model_artifacts import validate_model_bundle


def resolve_active_model(registry_dir: str | Path) -> dict[str, Any]:
    """Resolve and checksum-verify the approved active pointer without loading ONNX."""
    registry = Path(registry_dir).expanduser().resolve()
    pointer_path = registry / "active.json"
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError("No approved wake-word model is active in this registry.") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("The active wake-word model pointer is unreadable.") from exc
    if not isinstance(pointer, dict) or not isinstance(pointer.get("version"), str):
        raise ValueError("The active wake-word model pointer is invalid.")

    candidates_root = (registry / "candidates").resolve()
    candidate = (candidates_root / pointer["version"]).resolve()
    try:
        candidate.relative_to(candidates_root)
    except ValueError as exc:
        raise ValueError("The active model pointer escapes the candidate registry.") from exc
    if not candidate.is_dir():
        raise FileNotFoundError("The active wake-word model candidate is missing.")

    report = validate_model_bundle(candidate)
    if report["version"] != pointer["version"]:
        raise ValueError("The active model version does not match its candidate manifest.")
    if pointer.get("sha256") != report["sha256"]:
        raise ValueError("The active model checksum does not match its approved pointer.")
    if pointer.get("model_file") != report["model_file"]:
        raise ValueError("The active model file does not match its approved pointer.")
    return {
        "version": report["version"],
        "model_path": str((candidate / report["model_file"]).resolve()),
        "sha256": report["sha256"],
    }


def configured_registry_status() -> dict[str, Any]:
    """Return path-free status for the optional approved model registry."""
    raw = os.getenv("BOZZ_WAKE_WORD_REGISTRY", "").strip()
    if not raw:
        return {"registry_configured": False, "active_version": None, "registry_status": "environment_model"}
    try:
        active = resolve_active_model(Path(raw))
    except FileNotFoundError:
        return {"registry_configured": True, "active_version": None, "registry_status": "no_active_model"}
    except (ValueError, OSError):
        return {"registry_configured": True, "active_version": None, "registry_status": "active_model_invalid"}
    return {
        "registry_configured": True,
        "active_version": active["version"],
        "registry_status": "active_model_verified",
    }
