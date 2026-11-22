from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.voice.training import prepare_training_config


class WakeWordTrainingPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.piper = self.root / "piper"
        self.piper.mkdir()
        (self.piper / "generate_samples.py").write_text("# local test stub\n", encoding="utf-8")
        self.rir = self.root / "rir"
        self.rir.mkdir()
        self.background = self.root / "background"
        self.background.mkdir()
        self.features = self.root / "features.npy"
        self.features.write_bytes(b"test")
        self.fp = self.root / "false-positive.npy"
        self.fp.write_bytes(b"test")
        self.output = self.root / "training-output"
        self.plan = self.root / "plan.json"
        self.config = self.root / "openwakeword-config.yml"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_plan(self, **overrides) -> None:
        plan = {
            "model_name": "bozz",
            "target_phrase": ["BOZZ"],
            "piper_sample_generator_path": str(self.piper),
            "output_dir": str(self.output),
            "rir_paths": [str(self.rir)],
            "background_paths": [str(self.background)],
            "false_positive_validation_data_path": str(self.fp),
            "feature_data_files": {"licensed_features": str(self.features)},
        }
        plan.update(overrides)
        self.plan.write_text(json.dumps(plan), encoding="utf-8")

    def test_generates_openwakeword_compatible_config_without_training(self) -> None:
        self.write_plan()
        report = prepare_training_config(self.plan, self.config)
        config = json.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "training_preflight_passed_config_only")
        self.assertFalse(report["training_started"])
        self.assertEqual(config["target_phrase"], ["BOZZ"])
        self.assertEqual(config["batch_n_per_class"]["licensed_features"], 64)
        self.assertEqual(config["tts_batch_size"], 1)
        self.assertEqual(config["augmentation_batch_size"], 1)

    def test_rejects_wrong_target_phrase(self) -> None:
        self.write_plan(target_phrase=["different phrase"])
        with self.assertRaises(ValueError):
            prepare_training_config(self.plan, self.config)

    def test_rejects_missing_local_piper_entrypoint(self) -> None:
        (self.piper / "generate_samples.py").unlink()
        self.write_plan()
        with self.assertRaises(ValueError):
            prepare_training_config(self.plan, self.config)

    def test_rejects_missing_feature_file(self) -> None:
        self.write_plan(feature_data_files={"missing": str(self.root / "missing.npy")})
        with self.assertRaises(ValueError):
            prepare_training_config(self.plan, self.config)

    def test_rejects_invalid_batch_size(self) -> None:
        self.write_plan(tts_batch_size=0)
        with self.assertRaises(ValueError):
            prepare_training_config(self.plan, self.config)


if __name__ == "__main__":
    unittest.main()
