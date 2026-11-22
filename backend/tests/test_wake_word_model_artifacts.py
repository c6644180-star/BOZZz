from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.voice.model_artifacts import stage_model_candidate, validate_model_bundle


class WakeWordModelArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        self.model = self.bundle / "bozz.onnx"
        self.model.write_bytes(b"test-only-placeholder-not-a-real-onnx-model")
        self.manifest = {
            "schema_version": 1,
            "artifact_type": "bozz-wake-word-classifier",
            "model_id": "bozz-wake-word",
            "version": "1.0.0",
            "target_phrase": "BOZZ",
            "sample_rate_hz": 16000,
            "model_file": "bozz.onnx",
            "sha256": hashlib.sha256(self.model.read_bytes()).hexdigest(),
            "training_dataset_id": "local-dataset-v1",
            "training_code_version": "gate-10-test",
            "license": {"identifier": "owner-created-data-and-model", "commercial_use_allowed": True},
            "evaluation": {
                "positive_recall": 0.9,
                "false_activations_per_hour": 0.2,
                "test_audio_hours": 2.0,
                "test_speakers": 3,
                "held_out_test": True,
            },
        }
        self.write_manifest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_manifest(self) -> None:
        (self.bundle / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_validates_metadata_and_checksum_without_loading_model(self) -> None:
        report = validate_model_bundle(self.bundle)
        self.assertEqual(report["status"], "candidate_validated_not_loaded")
        self.assertEqual(report["version"], "1.0.0")

    def test_rejects_checksum_mismatch(self) -> None:
        self.manifest["sha256"] = "0" * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "checksum"):
            validate_model_bundle(self.bundle)

    def test_rejects_non_commercial_rights_declaration(self) -> None:
        self.manifest["license"]["commercial_use_allowed"] = False
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "commercial use"):
            validate_model_bundle(self.bundle)

    def test_rejects_evaluation_without_held_out_test(self) -> None:
        self.manifest["evaluation"]["held_out_test"] = False
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "held_out_test"):
            validate_model_bundle(self.bundle)

    def test_rejects_path_escape(self) -> None:
        outside = self.root / "outside.onnx"
        outside.write_bytes(b"outside")
        self.manifest["model_file"] = "../outside.onnx"
        self.manifest["sha256"] = hashlib.sha256(outside.read_bytes()).hexdigest()
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "inside the candidate bundle"):
            validate_model_bundle(self.bundle)

    def test_stages_candidate_without_changing_active_model(self) -> None:
        registry = self.root / "registry"
        report = stage_model_candidate(self.bundle, registry)
        self.assertEqual(report["status"], "staged_pending_user_approval")
        self.assertFalse(report["active_model_changed"])
        self.assertTrue((registry / "candidates" / "1.0.0" / "model.onnx").is_file())
        self.assertFalse((registry / "active.json").exists())

    def test_refuses_to_overwrite_existing_version(self) -> None:
        registry = self.root / "registry"
        stage_model_candidate(self.bundle, registry)
        with self.assertRaises(FileExistsError):
            stage_model_candidate(self.bundle, registry)


if __name__ == "__main__":
    unittest.main()
