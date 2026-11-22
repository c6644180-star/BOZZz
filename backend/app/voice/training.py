from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_MODEL_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,48}$")


def _existing_directory(value: Any, name: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty local directory path.")
    path = Path(value).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"{name} must point to an existing local directory.")
    return path


def _existing_file(value: Any, name: str, suffix: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty local file path.")
    path = Path(value).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() != suffix:
        raise ValueError(f"{name} must point to an existing {suffix} file.")
    return path


def prepare_training_config(plan_path: str | Path, output_config: str | Path) -> dict[str, Any]:
    """Validate local training inputs and write openWakeWord-compatible YAML (JSON subset).

    This is a preflight/configuration step only: no audio is recorded, generated,
    transformed, uploaded, or used for training.
    """
    source = Path(plan_path).expanduser().resolve()
    try:
        plan = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Training plan must be readable JSON ({type(exc).__name__}).") from exc
    if not isinstance(plan, dict):
        raise ValueError("Training plan must be a JSON object.")

    model_name = plan.get("model_name", "bozz")
    if not isinstance(model_name, str) or not _MODEL_NAME.fullmatch(model_name):
        raise ValueError("model_name may contain only letters, digits, underscore and hyphen (max 48 chars).")
    if plan.get("target_phrase", ["BOZZ"]) != ["BOZZ"]:
        raise ValueError('target_phrase must be exactly ["BOZZ"].')

    piper = _existing_directory(plan.get("piper_sample_generator_path"), "piper_sample_generator_path")
    if not (piper / "generate_samples.py").is_file():
        raise ValueError("piper_sample_generator_path must contain generate_samples.py from the compatible local Piper sample generator.")
    output_dir = Path(plan.get("output_dir", "")).expanduser().resolve()
    if not str(plan.get("output_dir", "")).strip():
        raise ValueError("output_dir must be a non-empty path outside the Git repository.")
    output_dir.mkdir(parents=True, exist_ok=True)

    rir_paths = [_existing_directory(p, f"rir_paths[{i}]") for i, p in enumerate(plan.get("rir_paths", []))]
    background_paths = [_existing_directory(p, f"background_paths[{i}]") for i, p in enumerate(plan.get("background_paths", []))]
    if not rir_paths or not background_paths:
        raise ValueError("At least one local room-impulse-response directory and one local background-audio directory are required.")

    false_positive_data = _existing_file(plan.get("false_positive_validation_data_path"), "false_positive_validation_data_path", ".npy")
    feature_files = plan.get("feature_data_files")
    if not isinstance(feature_files, dict) or not feature_files:
        raise ValueError("feature_data_files must contain at least one precomputed, licensed .npy feature dataset.")
    validated_features: dict[str, str] = {}
    for name, raw_path in feature_files.items():
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Every feature_data_files key must be a non-empty label.")
        validated_features[name] = str(_existing_file(raw_path, f"feature_data_files.{name}", ".npy"))

    def integer(key: str, default: int, minimum: int = 1, maximum: int = 1000000) -> int:
        value = plan.get(key, default)
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
            raise ValueError(f"{key} must be an integer between {minimum} and {maximum}.")
        return value

    n_samples = integer("n_samples", 20000, 2000, 500000)
    n_samples_val = integer("n_samples_val", 2000, 200, 100000)
    tts_batch = integer("tts_batch_size", 1, 1, 8)
    augmentation_batch = integer("augmentation_batch_size", 1, 1, 8)
    augmentation_rounds = integer("augmentation_rounds", 1, 1, 20)
    layer_size = integer("layer_size", 32, 8, 128)
    steps = integer("steps", 5000, 100, 100000)
    batch_positive = integer("batch_positive", 16, 1, 128)
    batch_negative = integer("batch_negative", 16, 1, 128)
    batch_external = integer("batch_external", 64, 1, 256)
    max_negative_weight = integer("max_negative_weight", 1500, 1, 10000)
    target_fp = plan.get("target_false_positives_per_hour", 0.5)
    if isinstance(target_fp, bool) or not isinstance(target_fp, (int, float)) or not 0.01 <= target_fp <= 100:
        raise ValueError("target_false_positives_per_hour must be between 0.01 and 100.")

    config = {
        "model_name": model_name,
        "target_phrase": ["BOZZ"],
        "custom_negative_phrases": plan.get("custom_negative_phrases", []),
        "n_samples": n_samples,
        "n_samples_val": n_samples_val,
        "tts_batch_size": tts_batch,
        "augmentation_batch_size": augmentation_batch,
        "piper_sample_generator_path": str(piper),
        "output_dir": str(output_dir),
        "rir_paths": [str(p) for p in rir_paths],
        "background_paths": [str(p) for p in background_paths],
        "background_paths_duplication_rate": [1 for _ in background_paths],
        "false_positive_validation_data_path": str(false_positive_data),
        "augmentation_rounds": augmentation_rounds,
        "feature_data_files": validated_features,
        "batch_n_per_class": {
            **{name: batch_external for name in validated_features},
            "adversarial_negative": batch_negative,
            "positive": batch_positive,
        },
        "model_type": "dnn",
        "layer_size": layer_size,
        "steps": steps,
        "max_negative_weight": max_negative_weight,
        "target_false_positives_per_hour": float(target_fp),
    }

    destination = Path(output_config).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return {
        "status": "training_preflight_passed_config_only",
        "config_path": str(destination),
        "model_name": model_name,
        "target_phrase": "BOZZ",
        "output_dir": str(output_dir),
        "training_started": False,
        "microphone_opened": False,
        "network_used": False,
        "audio_uploaded": False,
        "resource_profile": {
            "tts_batch_size": tts_batch,
            "augmentation_batch_size": augmentation_batch,
            "positive_batch_per_step": batch_positive,
            "negative_batch_per_step": batch_negative,
            "external_feature_batch_per_source": batch_external,
            "training_steps": steps,
        },
        "warning": "Configuration only. Training requires the compatible upstream openWakeWord training source and its optional dependencies. A small CPU configuration is for experimentation, not a reliable production model.",
    }
