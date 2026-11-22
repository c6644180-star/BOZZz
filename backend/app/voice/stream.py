from __future__ import annotations

import array
import ipaddress
import os
import sys
from dataclasses import dataclass


FRAME_SAMPLES = 1280
FRAME_BYTES = FRAME_SAMPLES * 2
DEFAULT_THRESHOLD = 0.5
REQUIRED_CONSECUTIVE_FRAMES = 2


def allowed_wake_word_origin(origin: str | None) -> bool:
    """Only accept the configured local BOZZ renderer origins."""
    configured = os.getenv(
        "BOZZ_WAKE_WORD_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    allowed = {item.strip().rstrip("/") for item in configured.split(",") if item.strip()}
    return bool(origin and origin.rstrip("/") in allowed)


def is_loopback_client(host: str | None) -> bool:
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def pcm16_mono_frame(data: bytes) -> array.array:
    """Decode one little-endian 16 kHz mono int16 detector frame."""
    if len(data) != FRAME_BYTES:
        raise ValueError("Audio frame must contain exactly 1,280 mono int16 samples.")
    samples = array.array("h")
    samples.frombytes(data)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


@dataclass
class WakeWordScoreGate:
    threshold: float = DEFAULT_THRESHOLD
    required_consecutive_frames: int = REQUIRED_CONSECUTIVE_FRAMES
    consecutive: int = 0

    def __post_init__(self) -> None:
        if not 0.0 < self.threshold <= 1.0:
            raise ValueError("Wake-word threshold must be greater than 0 and at most 1.")
        if self.required_consecutive_frames < 1:
            raise ValueError("At least one consecutive frame is required.")

    def update(self, score: float) -> bool:
        if not 0.0 <= score <= 1.0:
            raise ValueError("Wake-word score must be between 0 and 1.")
        self.consecutive = self.consecutive + 1 if score >= self.threshold else 0
        if self.consecutive >= self.required_consecutive_frames:
            self.consecutive = 0
            return True
        return False
