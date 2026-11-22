from __future__ import annotations

import json
import tempfile
import unittest
import wave
from array import array
from pathlib import Path

from app.voice.evaluation import evaluate_manifest


class FakeDetector:
    def __init__(self) -> None:
        self.stopped = False

    def score_frame(self, samples: array) -> dict[str, float]:
        return {"bozz": 0.9 if samples[0] > 0 else 0.1}

    def reset(self) -> None:
        pass

    def stop(self) -> None:
        self.stopped = True


class WakeWordEvaluationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.detector = FakeDetector()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_wav(self, name: str, sample: int, frames: int = 16000) -> None:
        path = self.root / name
        samples = array("h", [sample]) * frames
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(samples.tobytes())

    def write_manifest(self, rows: list[dict[str, str]]) -> Path:
        path = self.root / "manifest.jsonl"
        path.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
        return path

    def test_reports_clip_recall_and_negative_false_activations(self) -> None:
        self.write_wav("positive.wav", 1000)
        self.write_wav("negative.wav", -1000)
        manifest = self.write_manifest([
            {"path": "positive.wav", "label": "positive"},
            {"path": "negative.wav", "label": "negative"},
        ])
        report = evaluate_manifest(manifest, threshold=0.5, detector_factory=lambda: self.detector)
        self.assertEqual(report["positive_clips"], 1)
        self.assertEqual(report["positive_detected"], 1)
        self.assertEqual(report["positive_recall"], 1.0)
        self.assertEqual(report["false_activations"], 0)
        self.assertFalse(report["microphone_opened"])
        self.assertFalse(report["audio_uploaded"])
        self.assertTrue(self.detector.stopped)

    def test_counts_repeated_negative_triggers_using_cooldown(self) -> None:
        self.write_wav("negative.wav", 1000, frames=32000)
        manifest = self.write_manifest([{"path": "negative.wav", "label": "negative"}])
        report = evaluate_manifest(
            manifest, threshold=0.5, cooldown_ms=1000, detector_factory=lambda: self.detector
        )
        self.assertEqual(report["false_activations"], 2)
        self.assertAlmostEqual(report["false_activations_per_hour"], 3600.0)

    def test_rejects_wrong_audio_format(self) -> None:
        path = self.root / "wrong.wav"
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(array("h", [0, 0] * 1280).tobytes())
        manifest = self.write_manifest([{"path": "wrong.wav", "label": "positive"}])
        with self.assertRaisesRegex(ValueError, "mono 16-bit PCM WAV at 16 kHz"):
            evaluate_manifest(manifest, detector_factory=lambda: self.detector)

    def test_rejects_invalid_manifest_label(self) -> None:
        manifest = self.write_manifest([{"path": "sample.wav", "label": "maybe"}])
        with self.assertRaisesRegex(ValueError, "positive.*negative"):
            evaluate_manifest(manifest, detector_factory=lambda: self.detector)


if __name__ == "__main__":
    unittest.main()
