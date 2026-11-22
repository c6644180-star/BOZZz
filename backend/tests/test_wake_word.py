from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.voice.wake_word import LocalWakeWordDetector, wake_word_model_status


class FakeModel:
    def __init__(self) -> None:
        self.frames: list[np.ndarray] = []
        self.reset_calls = 0

    def predict(self, frame: np.ndarray) -> dict[str, float]:
        self.frames.append(frame.copy())
        return {"bozz": 0.42}

    def reset(self) -> None:
        self.reset_calls += 1


class WakeWordModelDiagnosticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.paths = {
            "BOZZ_WAKE_WORD_MODEL": self.root / "bozz.onnx",
            "BOZZ_WAKE_WORD_MELSPEC_MODEL": self.root / "melspectrogram.onnx",
            "BOZZ_WAKE_WORD_EMBEDDING_MODEL": self.root / "embedding_model.onnx",
        }
        for path in self.paths.values():
            path.write_bytes(b"placeholder")
        self.env = {name: str(path) for name, path in self.paths.items()}

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_unconfigured_assets_are_unavailable(self) -> None:
        with patch.dict(os.environ, {name: "" for name in self.paths}):
            result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "assets_missing")
        self.assertFalse(result["microphone_opened"])

    def test_missing_asset_is_reported_without_importing_engine(self) -> None:
        env = dict(self.env)
        env["BOZZ_WAKE_WORD_MODEL"] = str(self.root / "missing.onnx")
        with patch.dict(os.environ, env):
            with patch("app.voice.wake_word.importlib.import_module") as load:
                result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "assets_missing")
        load.assert_not_called()

    def test_non_onnx_asset_is_rejected(self) -> None:
        bad = self.root / "classifier.bin"
        bad.write_bytes(b"placeholder")
        env = dict(self.env)
        env["BOZZ_WAKE_WORD_MODEL"] = str(bad)
        with patch.dict(os.environ, env):
            result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "unsupported_format")

    def test_status_does_not_construct_model(self) -> None:
        with patch.dict(os.environ, self.env):
            with patch("app.voice.wake_word.importlib.import_module") as load:
                load.side_effect = [object(), object(), object()]
                result = wake_word_model_status(validate=False)
        self.assertEqual(result["status"], "assets_configured")
        self.assertFalse(result["engine_loadable"])

    def test_explicit_validation_constructs_openwakeword_without_audio_capture(self) -> None:
        class FakeEngine:
            def __init__(self, **kwargs: object) -> None:
                self.models = {"bozz": object()}
        fake_module = type("FakeModule", (), {"Model": FakeEngine})
        def importer(name: str) -> object:
            if name == "onnxruntime":
                return object()
            if name == "numpy":
                return np
            if name == "openwakeword.model":
                return fake_module
            raise ImportError(name)
        with patch.dict(os.environ, self.env):
            with patch("app.voice.wake_word.importlib.import_module", side_effect=importer):
                result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "engine_loadable_not_accuracy_verified")
        self.assertTrue(result["engine_loadable"])
        self.assertFalse(result["microphone_opened"])

    def test_runtime_error_does_not_mark_engine_ready(self) -> None:
        class BrokenEngine:
            def __init__(self, **kwargs: object) -> None:
                raise RuntimeError("bad model")
        fake_module = type("FakeModule", (), {"Model": BrokenEngine})
        def importer(name: str) -> object:
            if name == "onnxruntime":
                return object()
            if name == "numpy":
                return np
            if name == "openwakeword.model":
                return fake_module
            raise ImportError(name)
        with patch.dict(os.environ, self.env):
            with patch("app.voice.wake_word.importlib.import_module", side_effect=importer):
                result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "engine_invalid")
        self.assertFalse(result["engine_loadable"])


class LocalWakeWordDetectorTests(unittest.TestCase):
    def test_scores_only_valid_80ms_mono_pcm_frames(self) -> None:
        model = FakeModel()
        detector = LocalWakeWordDetector(model)
        frame = np.zeros(1280, dtype=np.int16)
        self.assertEqual(detector.score_frame(frame), {"bozz": 0.42})
        self.assertEqual(len(model.frames), 1)
        with self.assertRaises(ValueError):
            detector.score_frame(np.zeros(1280, dtype=np.float32))
        with self.assertRaises(ValueError):
            detector.score_frame(np.zeros(640, dtype=np.int16))
        with self.assertRaises(ValueError):
            detector.score_frame(np.zeros((1280, 2), dtype=np.int16))

    def test_stop_resets_model_and_blocks_future_frames(self) -> None:
        model = FakeModel()
        detector = LocalWakeWordDetector(model)
        detector.stop()
        self.assertEqual(model.reset_calls, 1)
        with self.assertRaises(RuntimeError):
            detector.score_frame(np.zeros(1280, dtype=np.int16))

    def test_load_requires_all_three_explicit_assets(self) -> None:
        with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": ""}):
            with self.assertRaises(RuntimeError):
                LocalWakeWordDetector.load(lambda **kwargs: FakeModel())


if __name__ == "__main__":
    unittest.main()
