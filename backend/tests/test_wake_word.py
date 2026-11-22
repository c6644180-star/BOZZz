from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from app.voice.wake_word import wake_word_model_status


class FakeInput:
    pass


class FakeSession:
    def __init__(self, model_path: str, providers: list[str]) -> None:
        self.model_path = model_path
        self.providers = providers

    def get_inputs(self) -> list[FakeInput]:
        return [FakeInput()]


class WakeWordModelDiagnosticsTests(unittest.TestCase):
    def test_unconfigured_model_is_honestly_unavailable(self) -> None:
        with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": ""}):
            result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "not_configured")
        self.assertFalse(result["model_loadable"])

    def test_missing_file_does_not_import_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            missing = str(Path(temp) / "missing.onnx")
            with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": missing}):
                with patch("app.voice.wake_word.importlib.import_module") as load:
                    result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "model_missing")
        load.assert_not_called()

    def test_non_onnx_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "model.bin"
            model.write_bytes(b"not a model")
            with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": str(model)}):
                result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "unsupported_format")

    def test_status_check_does_not_load_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "bozz.onnx"
            model.write_bytes(b"placeholder")
            runtime = types.SimpleNamespace(InferenceSession=FakeSession)
            with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": str(model)}):
                with patch("app.voice.wake_word.importlib.import_module", return_value=runtime) as load:
                    result = wake_word_model_status(validate=False)
        self.assertEqual(result["status"], "model_configured")
        self.assertFalse(result["model_loadable"])
        load.assert_called_once_with("onnxruntime")

    def test_explicit_validation_loads_onnx_on_cpu_without_audio_capture(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "bozz.onnx"
            model.write_bytes(b"placeholder")
            runtime = types.SimpleNamespace(InferenceSession=FakeSession)
            with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": str(model)}):
                with patch("app.voice.wake_word.importlib.import_module", return_value=runtime):
                    result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "onnx_loadable_not_accuracy_verified")
        self.assertTrue(result["model_loadable"])

    def test_runtime_error_does_not_mark_model_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "bozz.onnx"
            model.write_bytes(b"placeholder")
            def fail_session(*args: object, **kwargs: object) -> None:
                raise RuntimeError("invalid model")
            runtime = types.SimpleNamespace(InferenceSession=fail_session)
            with patch.dict(os.environ, {"BOZZ_WAKE_WORD_MODEL": str(model)}):
                with patch("app.voice.wake_word.importlib.import_module", return_value=runtime):
                    result = wake_word_model_status(validate=True)
        self.assertEqual(result["status"], "model_invalid")
        self.assertFalse(result["model_loadable"])


if __name__ == "__main__":
    unittest.main()
