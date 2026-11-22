from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.voice.model_artifacts import stage_model_candidate
from app.voice.model_runtime import resolve_active_model


class ActiveModelResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.registry = self.root / "registry"
        bundle = self.root / "bundle"
        bundle.mkdir()
        model = bundle / "model.onnx"
        model.write_bytes(b"test-only-placeholder")
        manifest = {
            "schema_version": 1, "artifact_type": "bozz-wake-word-classifier",
            "model_id": "bozz-wake-word", "version": "1.0.0", "target_phrase": "BOZZ",
            "sample_rate_hz": 16000, "model_file": "model.onnx",
            "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
            "training_dataset_id": "local-test", "training_code_version": "test",
            "license": {"identifier": "test-only", "commercial_use_allowed": True},
            "evaluation": {"positive_recall": 0.8, "false_activations_per_hour": 0.1, "test_audio_hours": 1.0, "test_speakers": 2, "held_out_test": True},
        }
        (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        stage_model_candidate(bundle, self.registry)
        self.candidate = self.registry / "candidates" / "1.0.0"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_pointer(self, *, version: str = "1.0.0", sha256: str | None = None, model_file: str = "model.onnx") -> None:
        manifest = json.loads((self.candidate / "manifest.json").read_text(encoding="utf-8"))
        (self.registry / "active.json").write_text(json.dumps({
            "version": version, "model_file": model_file,
            "sha256": sha256 if sha256 is not None else manifest["sha256"],
        }), encoding="utf-8")

    def test_resolves_verified_active_candidate(self) -> None:
        self.write_pointer()
        result = resolve_active_model(self.registry)
        self.assertEqual(result["version"], "1.0.0")
        resolved = Path(result["model_path"])\n        self.assertTrue(resolved.is_file())\n        self.assertEqual(resolved.name, "model.onnx")\n        self.assertEqual(resolved.parent.name, "1.0.0")

    def test_rejects_checksum_changed_after_activation(self) -> None:
        self.write_pointer()
        (self.candidate / "model.onnx").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            resolve_active_model(self.registry)

    def test_rejects_pointer_checksum_mismatch(self) -> None:
        self.write_pointer(sha256="0" * 64)
        with self.assertRaises(ValueError):
            resolve_active_model(self.registry)

    def test_rejects_pointer_path_escape(self) -> None:
        self.write_pointer(version="../../outside")
        with self.assertRaises(ValueError):
            resolve_active_model(self.registry)

    def test_requires_active_pointer(self) -> None:
        with self.assertRaises(FileNotFoundError):
            resolve_active_model(self.registry)


if __name__ == "__main__":
    unittest.main()
