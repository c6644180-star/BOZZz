from __future__ import annotations

import array
import json
import sys
import time
import tracemalloc
import wave
from pathlib import Path
from typing import Any, Callable


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Manifest line {line_number} is not valid JSON: {exc.msg}") from exc
        if not isinstance(row, dict) or row.get("label") not in {"positive", "negative"}:
            raise ValueError(f"Manifest line {line_number} must contain label 'positive' or 'negative'.")
        if not isinstance(row.get("path"), str) or not row["path"].strip():
            raise ValueError(f"Manifest line {line_number} must contain a non-empty path.")
        rows.append(row)
    if not rows:
        raise ValueError("The manifest contains no labelled audio clips.")
    return rows


def evaluate_manifest(
    manifest_path: str | Path,
    *,
    threshold: float = 0.5,
    thresholds: list[float] | None = None,
    cooldown_ms: int = 1000,
    detector_factory: Callable[[], Any] | None = None,
) -> dict[str, Any]:
    """Evaluate labelled local WAV clips. This function never records or uploads audio."""
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("threshold must be between 0 and 1.")
    if cooldown_ms < 0:
        raise ValueError("cooldown_ms cannot be negative.")

    sweep = sorted(set([threshold, *(thresholds or [])]))
    if any(not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0 for value in sweep):
        raise ValueError("Every sweep threshold must be between 0 and 1.")
    manifest = Path(manifest_path).expanduser().resolve()
    rows = _load_manifest(manifest)
    if detector_factory is None:
        from app.voice.wake_word import LocalWakeWordDetector
        detector_factory = LocalWakeWordDetector.load
    detector = detector_factory()
    started_at = time.perf_counter()
    trace_started_here = not tracemalloc.is_tracing()
    if trace_started_here:
        tracemalloc.start()

    total_audio_seconds = 0.0
    peak_python_memory_bytes: int | None = None
    positive_clips = negative_clips = 0
    negative_duration_seconds = 0.0
    metrics = {
        value: {"positive_detected": 0, "false_activations": 0}
        for value in sweep
    }
    clip_reports: list[dict[str, Any]] = []

    try:
        for row in rows:
            audio_path = Path(row["path"]).expanduser()
            if not audio_path.is_absolute():
                audio_path = (manifest.parent / audio_path).resolve()
            if not audio_path.is_file():
                raise ValueError(f"Audio file does not exist: {audio_path}")

            with wave.open(str(audio_path), "rb") as wav:
                if (
                    wav.getnchannels() != 1
                    or wav.getsampwidth() != 2
                    or wav.getframerate() != 16000
                    or wav.getcomptype() != "NONE"
                ):
                    raise ValueError(
                        f"{audio_path.name} must be uncompressed mono 16-bit PCM WAV at 16 kHz."
                    )
                frame_count = wav.getnframes()
                duration = frame_count / 16000.0
                total_audio_seconds += duration
                if frame_count < 1280:
                    raise ValueError(f"{audio_path.name} is shorter than one 80 ms detector frame.")

                is_positive = row["label"] == "positive"
                if is_positive:
                    positive_clips += 1
                else:
                    negative_clips += 1
                    negative_duration_seconds += duration

                detected = {value: False for value in sweep}
                false_counts = {value: 0 for value in sweep}
                last_activation_ms: dict[float, float | None] = {value: None for value in sweep}
                peak_score = 0.0
                frame_index = 0
                reset = getattr(detector, "reset", None)
                if callable(reset):
                    reset()
                while True:
                    raw = wav.readframes(1280)
                    if len(raw) < 1280 * 2:
                        break
                    samples = array.array("h")
                    samples.frombytes(raw)
                    if sys.byteorder != "little":
                        samples.byteswap()
                    scores = detector.score_frame(samples)
                    score = max((float(value) for value in scores.values()), default=0.0)
                    if not 0.0 <= score <= 1.0:
                        raise ValueError("Detector returned a score outside the 0..1 range.")
                    peak_score = max(peak_score, score)
                    timestamp_ms = frame_index * 80.0
                    for candidate in sweep:
                        previous = last_activation_ms[candidate]
                        if score >= candidate and (
                            previous is None or timestamp_ms - previous >= cooldown_ms
                        ):
                            last_activation_ms[candidate] = timestamp_ms
                            if is_positive:
                                detected[candidate] = True
                            else:
                                false_counts[candidate] += 1
                    frame_index += 1

                for candidate in sweep:
                    if is_positive and detected[candidate]:
                        metrics[candidate]["positive_detected"] += 1
                    elif not is_positive:
                        metrics[candidate]["false_activations"] += false_counts[candidate]

                clip_reports.append({
                    "file": audio_path.name,
                    "label": row["label"],
                    "duration_seconds": round(duration, 3),
                    "peak_score": round(peak_score, 6),
                    "detected_at_threshold": detected[threshold],
                    "false_activations_at_threshold": false_counts[threshold] if not is_positive else None,
                })

    finally:
        stop = getattr(detector, "stop", None)
        if callable(stop):
            stop()
        if trace_started_here:
            _, peak_python_memory_bytes = tracemalloc.get_traced_memory()
            tracemalloc.stop()

    elapsed_seconds = time.perf_counter() - started_at
    negative_hours = negative_duration_seconds / 3600.0
    threshold_reports = []
    for candidate in sweep:
        positive_detected = metrics[candidate]["positive_detected"]
        false_activations = metrics[candidate]["false_activations"]
        threshold_reports.append({
            "threshold": candidate,
            "positive_detected": positive_detected,
            "positive_recall": round(positive_detected / positive_clips, 6) if positive_clips else None,
            "false_activations": false_activations,
            "false_activations_per_hour": round(false_activations / negative_hours, 6) if negative_hours else None,
        })
    selected = metrics[threshold]
    selected_false_activations = selected["false_activations"]
    return {
        "status": "evaluation_complete",
        "threshold": threshold,
        "threshold_sweep": threshold_reports,
        "cooldown_ms": cooldown_ms,
        "audio_format": "mono 16-bit PCM WAV, 16 kHz",
        "microphone_opened": False,
        "audio_uploaded": False,
        "evaluation_wall_seconds": round(elapsed_seconds, 4),
        "audio_seconds_evaluated": round(total_audio_seconds, 3),
        "real_time_factor": round(elapsed_seconds / total_audio_seconds, 6) if total_audio_seconds else None,
        "peak_python_memory_bytes": peak_python_memory_bytes,
        "memory_metric_note": "Python traced allocations only; native ONNX Runtime and total process memory are not included.",
        "positive_clips": positive_clips,
        "positive_detected": selected["positive_detected"],
        "positive_recall": round(selected["positive_detected"] / positive_clips, 6) if positive_clips else None,
        "negative_clips": negative_clips,
        "negative_audio_hours": round(negative_hours, 6),
        "false_activations": selected_false_activations,
        "false_activations_per_hour": round(selected_false_activations / negative_hours, 6) if negative_hours else None,
        "clips": clip_reports,
        "interpretation": "Results describe only the supplied labelled clips and thresholds; they do not guarantee real-world accuracy or wake-word reliability.",
    }
