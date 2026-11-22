from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.voice.model_artifacts import stage_model_candidate
from app.voice.model_lifecycle import activate_candidate, rollback_active_model


class WakeWordModelLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.registry = self.root / "registry"
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        model = self.bundle / "model.onnx"
        model.write_bytes(b"placeholder-only-test-model")
        manifest = {
            "schema_version": 1, "artifact_type": "bozz-wake-word-classifier",
            "model_id": "bozz-wake-word", "version": "1.0.0", "target_phrase": "BOZZ",
            "sample_rate_hz": 16000, "model_file": "model.onnx",
            "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
            "training_dataset_id": "local-test", "training_code_version": "test",
            "license": {"identifier": "test-owner-data", "commercial_use_allowed": True},
            "evaluation": {"positive_recall": 0.8, "false_activations_per_hour": 0.1, "test_audio_hours": 1.0, "test_speakers": 2, "held_out_test": True},
        }
        (self.bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        stage_model_candidate(self.bundle, self.registry)
        self.runtime_ok = lambda path: {"status": "runtime_loadable_not_accuracy_verified"}

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_activation_requires_explicit_approval(self) -> None:
        with self.assertRaises(PermissionError):
            activate_candidate(self.registry, "1.0.0", approved=False, runtime_validator=self.runtime_ok)
        self.assertFalse((self.registry / "active.json").exists())

    def test_activation_requires_runtime_success(self) -> None:
        with self.assertRaises(RuntimeError):
            activate_candidate(self.registry, "1.0.0", approved=True, runtime_validator=lambda path: {"status": "runtime_error"})
        self.assertFalse((self.registry / "active.json").exists())

    def test_first_activation_writes_active_pointer(self) -> None:
        result = activate_candidate(self.registry, "1.0.0", approved=True, runtime_validator=self.runtime_ok)
        self.assertEqual(result["active_version"], "1.0.0")
        self.assertEqual(json.loads((self.registry / "active.json").read_text())["version"], "1.0.0")
        self.assertFalse((self.registry / "rollback.json").exists())

    def test_second_activation_can_be_rolled_back(self) -> None:
        activate_candidate(self.registry, "1.0.0", approved=True, runtime_validator=self.runtime_ok)
        second = self.root / "bundle-1.1"
        second.mkdir()
        model = second / "model.onnx"
        model.write_bytes(b"second-placeholder-model")
        manifest = json.loads((self.bundle / "manifest.json").read_text())
        manifest.update({"version": "1.1.0", "model_file": "model.onnx", "sha256": hashlib.sha256(model.read_bytes()).hexdigest()})
        (second / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        stage_model_candidate(second, self.registry)
        activate_candidate(self.registry, "1.1.0", approved=True, runtime_validator=self.runtime_ok)
        result = rollback_active_model(self.registry, approved=True)
        self.assertEqual(result["active_version"], "1.0.0")
        self.assertEqual(json.loads((self.registry / "active.json").read_text())["version"], "1.0.0")

    def test_rollback_requires_approval(self) -> None:
        activate_candidate(self.registry, "1.0.0", approved=True, runtime_validator=self.runtime_ok)
        with self.assertRaises(PermissionError):
            rollback_active_model(self.registry, approved=False)


if __name__ == "__main__":
    unittest.main()
