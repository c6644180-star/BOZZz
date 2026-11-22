from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$")
_ARTIFACT_TYPE = "bozz-wake-word-classifier"


def _json_file(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read valid JSON manifest: {type(exc).__name__}.") from exc
    if not isinstance(value, dict):
        raise ValueError("Model manifest must be a JSON object.")
    return value


def _contained_file(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative.strip():
        raise ValueError("model_file must be a non-empty relative path.")
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("Model file must remain inside the candidate bundle.") from exc
    if not candidate.is_file() or candidate.suffix.lower() != ".onnx":
        raise ValueError("Model file must be an existing ONNX file inside the candidate bundle.")
    return candidate


def validate_model_bundle(bundle_dir: str | Path) -> dict[str, Any]:
    """Validate metadata and checksum; does not execute or load the ONNX model."""
    root = Path(bundle_dir).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("Candidate bundle directory does not exist.")
    manifest = _json_file(root / "manifest.json")
    required = (
        "schema_version", "artifact_type", "model_id", "version", "target_phrase",
        "sample_rate_hz", "model_file", "sha256", "training_dataset_id",
        "training_code_version", "license", "evaluation",
    )
    missing = [key for key in required if key not in manifest]
    if missing:
        raise ValueError(f"Manifest is missing required fields: {', '.join(missing)}.")
    if manifest["schema_version"] != 1 or manifest["artifact_type"] != _ARTIFACT_TYPE:
        raise ValueError("Unsupported model artifact schema or artifact_type.")
    if not isinstance(manifest["model_id"], str) or not manifest["model_id"].strip():
        raise ValueError("model_id must be a non-empty string.")
    version = manifest["version"]
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        raise ValueError("version must use semantic version format, for example 1.0.0.")
    if manifest["target_phrase"] != "BOZZ":
        raise ValueError("Candidate target_phrase must be exactly BOZZ.")
    if manifest["sample_rate_hz"] != 16000:
        raise ValueError("Candidate sample_rate_hz must be 16000.")
    for key in ("training_dataset_id", "training_code_version"):
        if not isinstance(manifest[key], str) or not manifest[key].strip():
            raise ValueError(f"{key} must be a non-empty string.")

    model_path = _contained_file(root, manifest["model_file"])
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if not isinstance(manifest["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", manifest["sha256"]):
        raise ValueError("sha256 must be a lowercase SHA-256 hex digest.")
    if digest != manifest["sha256"]:
        raise ValueError("Model checksum does not match manifest sha256.")

    license_info = manifest["license"]
    if not isinstance(license_info, dict):
        raise ValueError("license must be an object with identifier and commercial_use_allowed.")
    if not isinstance(license_info.get("identifier"), str) or not license_info["identifier"].strip():
        raise ValueError("A license identifier or documented rights basis is required.")
    if license_info.get("commercial_use_allowed") is not True:
        raise ValueError("Candidate is blocked unless its declared rights permit commercial use.")
    evaluation = manifest["evaluation"]
    if not isinstance(evaluation, dict):
        raise ValueError("evaluation must be an object.")
    recall = evaluation.get("positive_recall")
    false_rate = evaluation.get("false_activations_per_hour")
    test_hours = evaluation.get("test_audio_hours")
    test_speakers = evaluation.get("test_speakers")
    if not isinstance(recall, (int, float)) or isinstance(recall, bool) or not 0 <= recall <= 1:
        raise ValueError("evaluation.positive_recall must be between 0 and 1.")
    if not isinstance(false_rate, (int, float)) or isinstance(false_rate, bool) or false_rate < 0:
        raise ValueError("evaluation.false_activations_per_hour must be non-negative.")
    if not isinstance(test_hours, (int, float)) or isinstance(test_hours, bool) or test_hours <= 0:
        raise ValueError("evaluation.test_audio_hours must be greater than zero.")
    if not isinstance(test_speakers, int) or isinstance(test_speakers, bool) or test_speakers < 1:
        raise ValueError("evaluation.test_speakers must be a positive integer.")
    if evaluation.get("held_out_test") is not True:
        raise ValueError("Evaluation must explicitly confirm held_out_test=true.")

    return {
        "status": "candidate_validated_not_loaded",
        "model_id": manifest["model_id"],
        "version": version,
        "target_phrase": "BOZZ",
        "model_file": model_path.name,
        "sha256": digest,
        "positive_recall": float(recall),
        "false_activations_per_hour": float(false_rate),
        "test_audio_hours": float(test_hours),
        "test_speakers": test_speakers,
        "commercial_use_declared": True,
        "warning": "Metadata and checksum validation only. This does not verify ONNX graph compatibility, license claims, model accuracy, or live reliability.",
    }


def stage_model_candidate(bundle_dir: str | Path, registry_dir: str | Path) -> dict[str, Any]:
    """Copy a validated candidate into a local staging folder without activation."""
    bundle = Path(bundle_dir).expanduser().resolve()
    report = validate_model_bundle(bundle)
    registry = Path(registry_dir).expanduser().resolve()
    candidates = registry / "candidates"
    candidates.mkdir(parents=True, exist_ok=True)
    destination = candidates / report["version"]
    if destination.exists():
        raise FileExistsError(f"Candidate version {report['version']} already exists; versions are never overwritten.")

    manifest = _json_file(bundle / "manifest.json")
    source_model = _contained_file(bundle, manifest["model_file"])
    temporary = Path(tempfile.mkdtemp(prefix=".staging-", dir=candidates))
    try:
        shutil.copy2(source_model, temporary / "model.onnx")
        staged_manifest = dict(manifest)
        staged_manifest["model_file"] = "model.onnx"
        (temporary / "manifest.json").write_text(
            json.dumps(staged_manifest, indent=2) + "\n", encoding="utf-8"
        )
        staged_report = validate_model_bundle(temporary)
        if staged_report["sha256"] != report["sha256"]:
            raise ValueError("Staged model checksum changed during copy.")
        temporary.rename(destination)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    return {
        **report,
        "status": "staged_pending_user_approval",
        "staged_path": str(destination),
        "active_model_changed": False,
        "microphone_opened": False,
        "network_used": False,
    }
