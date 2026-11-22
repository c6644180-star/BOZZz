from __future__ import annotations

import unittest
from unittest.mock import patch

from app.voice.stream import (
    FRAME_BYTES,
    WakeWordScoreGate,
    allowed_wake_word_origin,
    is_loopback_client,
    pcm16_mono_frame,
)


class WakeWordStreamGuardTests(unittest.TestCase):
    def test_only_local_renderer_origins_are_allowed(self) -> None:
        with patch.dict("os.environ", {"BOZZ_WAKE_WORD_ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173"}):
            self.assertTrue(allowed_wake_word_origin("http://localhost:5173"))
            self.assertTrue(allowed_wake_word_origin("http://127.0.0.1:5173"))
            self.assertFalse(allowed_wake_word_origin("https://example.com"))
            self.assertFalse(allowed_wake_word_origin("null"))
            self.assertFalse(allowed_wake_word_origin(None))

    def test_only_loopback_clients_are_allowed(self) -> None:
        self.assertTrue(is_loopback_client("127.0.0.1"))
        self.assertTrue(is_loopback_client("::1"))
        self.assertFalse(is_loopback_client("192.168.1.10"))
        self.assertFalse(is_loopback_client(None))

    def test_pcm_frame_requires_exactly_80ms_of_mono_int16(self) -> None:
        frame = pcm16_mono_frame(bytes(FRAME_BYTES))
        self.assertEqual(len(frame), 1280)
        with self.assertRaises(ValueError):
            pcm16_mono_frame(bytes(FRAME_BYTES - 2))
        with self.assertRaises(ValueError):
            pcm16_mono_frame(bytes(FRAME_BYTES + 2))

    def test_score_gate_requires_two_consecutive_above_threshold_frames(self) -> None:
        gate = WakeWordScoreGate(threshold=0.5, required_consecutive_frames=2)
        self.assertFalse(gate.update(0.8))
        self.assertFalse(gate.update(0.2))
        self.assertFalse(gate.update(0.7))
        self.assertTrue(gate.update(0.9))
        self.assertFalse(gate.update(0.9))

    def test_score_gate_rejects_invalid_thresholds_and_scores(self) -> None:
        with self.assertRaises(ValueError):
            WakeWordScoreGate(threshold=0)
        with self.assertRaises(ValueError):
            WakeWordScoreGate(threshold=1.1)
        gate = WakeWordScoreGate()
        with self.assertRaises(ValueError):
            gate.update(1.5)


if __name__ == "__main__":
    unittest.main()
