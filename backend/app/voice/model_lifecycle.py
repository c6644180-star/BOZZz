from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

from app.voice.model_artifacts import validate_model_bundle

_RUNTIME_CHECK = r'''
import json, sys
from openwakeword.model import Model
candidate, melspec, embedding = sys.argv[1:4]
model = Model(wakeword_models=[candidate], inference_framework="onnx", melspec_model_path=melspec, embedding_model_path=embedding, ncpu=1)
loaded = list(getattr(model, "models", {}).keys())
if not loaded:
    raise RuntimeError("No wake-word model was loaded")
print(json.dumps({"loaded_models": loaded}))
'''


def validate_candidate_runtime(bundle_dir: str | Path, *, timeout_seconds: int = 30, runner: Callable[..., Any] = subprocess.run) -> dict[str, Any]:
    """Load-check candidate in a separate Python process; never opens a microphone."""
    bundle = Path(bundle_dir).expanduser().resolve()
    report = validate_model_bundle(bundle)
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    model_path = (bundle / manifest["model_file"]).resolve()
    melspec = os.getenv("BOZZ_WAKE_WORD_MELSPEC_MODEL", "").strip()
    embedding = os.getenv("BOZZ_WAKE_WORD_EMBEDDING_MODEL", "").strip()
    if not melspec or not Path(melspec).expanduser().is_file():
        raise ValueError("Set BOZZ_WAKE_WORD_MELSPEC_MODEL to an existing local ONNX feature model.")
    if not embedding or not Path(embedding).expanduser().is_file():
        raise ValueError("Set BOZZ_WAKE_WORD_EMBEDDING_MODEL to an existing local ONNX feature model.")
    try:
        completed = runner([sys.executable, "-I", "-c", _RUNTIME_CHECK, str(model_path), str(Path(melspec).expanduser().resolve()), str(Path(embedding).expanduser().resolve())], capture_output=True, text=True, timeout=timeout_seconds, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Isolated model validation timed out.") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or "Runtime validation failed").strip()[-1200:]
        raise RuntimeError(f"Candidate could not load in isolated runtime: {detail}")
    try:
        runtime = json.loads(completed.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise RuntimeError("Isolated runtime returned no valid load report.") from exc
    if not runtime.get("loaded_models"):
        raise RuntimeError("Isolated runtime did not report a loaded classifier.")
    return {"status": "runtime_loadable_not_accuracy_verified", "version": report["version"], "loaded_models": runtime["loaded_models"], "microphone_opened": False, "network_used_by_validator": False, "warning": "Runtime loading proves compatibility only, not phrase accuracy or safe false-activation rates."}


def _read_pointer(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("version"), str):
        raise ValueError(f"Invalid model pointer: {path.name}")
    return value


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".pointer-", suffix=".json", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def activate_candidate(registry_dir: str | Path, version: str, *, approved: bool, runtime_validator: Callable[[Path], dict[str, Any]] = validate_candidate_runtime) -> dict[str, Any]:
    """Activate only after explicit approval and isolated runtime validation."""
    if approved is not True:
        raise PermissionError("Explicit user approval is required before model activation.")
    registry = Path(registry_dir).expanduser().resolve()
    candidate = (registry / "candidates" / version).resolve()
    try:
        candidate.relative_to((registry / "candidates").resolve())
    except ValueError as exc:
        raise ValueError("Candidate version must remain inside the local registry.") from exc
    if not candidate.is_dir():
        raise FileNotFoundError("The requested staged candidate does not exist.")
    report = validate_model_bundle(candidate)
    if report["version"] != version:
        raise ValueError("Candidate folder version does not match its manifest.")
    runtime = runtime_validator(candidate)
    if runtime.get("status") != "runtime_loadable_not_accuracy_verified":
        raise RuntimeError("Candidate did not pass isolated runtime validation.")
    active_path, rollback_path = registry / "active.json", registry / "rollback.json"
    previous = _read_pointer(active_path)
    pointer = {"version": version, "model_file": "model.onnx", "sha256": report["sha256"]}
    if previous:
        _atomic_json(rollback_path, previous)
    _atomic_json(active_path, pointer)
    return {"status": "activated_after_approval", "active_version": version, "previous_version": previous.get("version") if previous else None, "runtime_validation": runtime["status"], "microphone_opened": False}


def rollback_active_model(registry_dir: str | Path, *, approved: bool) -> dict[str, Any]:
    """Swap active and rollback pointers; explicit approval is required."""
    if approved is not True:
        raise PermissionError("Explicit user approval is required before rollback.")
    registry = Path(registry_dir).expanduser().resolve()
    active_path, rollback_path = registry / "active.json", registry / "rollback.json"
    active, previous = _read_pointer(active_path), _read_pointer(rollback_path)
    if previous is None:
        raise FileNotFoundError("No previous model version is available for rollback.")
    candidate = (registry / "candidates" / previous["version"]).resolve()
    try:
        candidate.relative_to((registry / "candidates").resolve())
    except ValueError as exc:
        raise ValueError("Rollback target is outside the candidate registry.") from exc
    report = validate_model_bundle(candidate)
    if report["sha256"] != previous.get("sha256"):
        raise ValueError("Rollback candidate checksum no longer matches its pointer.")
    _atomic_json(active_path, previous)
    if active:
        _atomic_json(rollback_path, active)
    else:
        rollback_path.unlink(missing_ok=True)
    return {"status": "rolled_back_after_approval", "active_version": previous["version"], "previous_version": active.get("version") if active else None, "microphone_opened": False}
