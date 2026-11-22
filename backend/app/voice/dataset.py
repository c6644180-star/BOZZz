from __future__ import annotations

import hashlib
import json
import wave
from collections import defaultdict
from pathlib import Path
from typing import Any


SPLIT_NAMES = ("train", "validation", "test")


def _inside(root: Path, candidate: Path) -> Path:
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("Every dataset audio path must stay inside the selected dataset root.") from exc
    return resolved


def _read_source_manifest(path: Path, root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Manifest line {line_number} is not valid JSON: {exc.msg}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"Manifest line {line_number} must be a JSON object.")
        if row.get("label") not in {"positive", "negative"}:
            raise ValueError(f"Manifest line {line_number} label must be positive or negative.")
        for field in ("speaker_id", "source_id", "rights"):
            value = row.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Manifest line {line_number} requires a non-empty {field}.")
        if row.get("consent_confirmed") is not True:
            raise ValueError(f"Manifest line {line_number} must confirm permission/rights with consent_confirmed=true.")
        raw_path = row.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ValueError(f"Manifest line {line_number} requires a non-empty path.")
        audio = _inside(root, root / raw_path)
        if not audio.is_file() or audio.suffix.lower() != ".wav":
            raise ValueError(f"Manifest line {line_number} must point to an existing WAV file inside the dataset root.")
        with wave.open(str(audio), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000 or wav.getcomptype() != "NONE":
                raise ValueError(f"{audio.name} must be uncompressed mono 16-bit PCM WAV at 16 kHz.")
            frames = wav.getnframes()
            duration = frames / 16000.0
            if duration < 0.08 or duration > 10.0:
                raise ValueError(f"{audio.name} must be between 0.08 and 10 seconds.")
        rows.append({
            "path": audio.relative_to(root).as_posix(),
            "label": row["label"],
            "speaker_id": row["speaker_id"].strip(),
            "source_id": row["source_id"].strip(),
            "rights": row["rights"].strip(),
            "duration_seconds": round(duration, 4),
        })
    if not rows:
        raise ValueError("The source manifest contains no usable clips.")
    return rows


def prepare_dataset(
    manifest_path: str | Path,
    output_dir: str | Path,
    *,
    seed: str = "bozz-wake-word-v1",
    train_ratio: float = 0.7,
    validation_ratio: float = 0.15,
) -> dict[str, Any]:
    """Validate a local labelled dataset and split by speaker to prevent leakage.

    No microphone, network, model training, audio transformation, or upload is used.
    Audio files remain in place; only local JSONL manifests and a report are written.
    """
    if not 0.0 < train_ratio < 1.0 or not 0.0 < validation_ratio < 1.0:
        raise ValueError("Train and validation ratios must be between 0 and 1.")
    if train_ratio + validation_ratio >= 1.0:
        raise ValueError("Train and validation ratios must leave a non-empty test ratio.")

    manifest = Path(manifest_path).expanduser().resolve()
    root = manifest.parent.resolve()
    rows = _read_source_manifest(manifest, root)
    speaker_ids = sorted({row["speaker_id"] for row in rows})
    if len(speaker_ids) < 3:
        raise ValueError("At least three distinct anonymized speaker_id groups are required for train/validation/test splits.")

    # Deterministic speaker-level assignment: clips from one speaker never cross splits.
    ordered = sorted(
        speaker_ids,
        key=lambda speaker: hashlib.sha256(f"{seed}:{speaker}".encode("utf-8")).hexdigest(),
    )
    train_end = max(1, int(len(ordered) * train_ratio))
    validation_end = max(train_end + 1, int(len(ordered) * (train_ratio + validation_ratio)))
    if validation_end >= len(ordered):
        validation_end = len(ordered) - 1
    assignments = {
        **{speaker: "train" for speaker in ordered[:train_end]},
        **{speaker: "validation" for speaker in ordered[train_end:validation_end]},
        **{speaker: "test" for speaker in ordered[validation_end:]},
    }

    split_rows: dict[str, list[dict[str, Any]]] = {name: [] for name in SPLIT_NAMES}
    for row in rows:
        split_rows[assignments[row["speaker_id"]]].append(row)

    for split_name, split in split_rows.items():
        labels = {row["label"] for row in split}
        if labels != {"positive", "negative"}:
            raise ValueError(
                f"The {split_name} split must contain both positive and negative clips. "
                "Add more varied, permission-cleared speaker groups and retry."
            )

    output = Path(output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    summaries: dict[str, Any] = {}
    for split_name, split in split_rows.items():
        target = output / f"{split_name}.jsonl"
        # Evaluation/training consumers receive only path and label; provenance stays in the audit report.
        target.write_text(
            "".join(json.dumps({"path": row["path"], "label": row["label"]}, ensure_ascii=False) + "\\n" for row in split),
            encoding="utf-8",
        )
        summaries[split_name] = {
            "clips": len(split),
            "speakers": len({row["speaker_id"] for row in split}),
            "positive_clips": sum(row["label"] == "positive" for row in split),
            "negative_clips": sum(row["label"] == "negative" for row in split),
            "audio_seconds": round(sum(row["duration_seconds"] for row in split), 3),
            "manifest": target.name,
        }

    report = {
        "status": "dataset_prepared_not_model_trained",
        "audio_uploaded": False,
        "microphone_opened": False,
        "audio_transformed": False,
        "seed": seed,
        "source_clips": len(rows),
        "distinct_speakers": len(speaker_ids),
        "speaker_leakage_between_splits": False,
        "splits": summaries,
        "provenance": {
            "source_ids": sorted({row["source_id"] for row in rows}),
            "rights_statements": sorted({row["rights"] for row in rows}),
            "consent_confirmed_for_every_clip": True,
        },
        "warning": "This validates and partitions data only. It does not train, export, certify, or accuracy-verify a BOZZ wake-word model.",
    }
    (output / "dataset-report.json").write_text(json.dumps(report, indent=2) + "\\n", encoding="utf-8")
    return report
