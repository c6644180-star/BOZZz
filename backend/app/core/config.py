from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
import os

# backend/app/core/config.py -> repository root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DATA_DIR = _REPO_ROOT / "data"


def _load_env_file() -> None:
    """Load backend/.env before Settings defaults are evaluated.

    Existing process variables win, so `--env-file` and shell exports still
    override the file. Values are never logged.
    """
    path = _BACKEND_ROOT / ".env"
    if not path.is_file():
        return
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_env_file()


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _path_env(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    return Path(raw).expanduser() if raw and raw.strip() else default


@dataclass(frozen=True)
class Settings:
    """Runtime configuration for local-only BOZZ services.

    Values are read from the environment when the app is created. Tests and
    tools may construct Settings directly with explicit paths.
    """

    ollama_base_url: str = os.getenv("BOZZ_OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("BOZZ_OLLAMA_MODEL", "qwen2.5:1.5b")
    request_timeout_seconds: float = _float_env("BOZZ_MODEL_TIMEOUT_SECONDS", 60.0)

    data_dir: Path = _path_env("BOZZ_DATA_DIR", _DEFAULT_DATA_DIR)
    workspace_dirname: str = "workspace"
    database_filename: str = "bozz.sqlite3"
    trash_dirname: str = ".trash"

    max_read_bytes: int = _int_env("BOZZ_MAX_READ_BYTES", 262_144)
    max_write_bytes: int = _int_env("BOZZ_MAX_WRITE_BYTES", 262_144)
    max_search_results: int = _int_env("BOZZ_MAX_SEARCH_RESULTS", 20)
    log_level: str = os.getenv("BOZZ_LOG_LEVEL", "INFO").upper()

    # ElevenLabs text-to-speech. The key stays server-side and is hidden from repr.
    elevenlabs_api_key: str = field(default=os.getenv("ELEVENLABS_API_KEY", ""), repr=False)
    elevenlabs_voice_id: str = os.getenv("ELEVENLABS_VOICE_ID", "")
    elevenlabs_model_id: str = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
    elevenlabs_base_url: str = os.getenv("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1")
    tts_chunk_chars: int = _int_env("BOZZ_TTS_CHUNK_CHARS", 500)
    tts_max_total_chars: int = _int_env("BOZZ_TTS_MAX_TOTAL_CHARS", 4_000)
    tts_timeout_seconds: float = _float_env("BOZZ_TTS_TIMEOUT_SECONDS", 45.0)

    # Gesture-driven desktop mouse control (disabled until explicitly enabled).
    desktop_min_confidence: float = _float_env("BOZZ_DESKTOP_MIN_CONFIDENCE", 0.7)
    desktop_rate_limit: int = _int_env("BOZZ_DESKTOP_RATE_LIMIT", 60)
    desktop_area: float = _float_env("BOZZ_DESKTOP_AREA", 0.8)
    desktop_edge_margin: int = _int_env("BOZZ_DESKTOP_EDGE_MARGIN", 12)
    desktop_emergency_hotkey: str = os.getenv("BOZZ_DESKTOP_HOTKEY", "<ctrl>+<alt>+q")
    desktop_idle_seconds: int = _int_env("BOZZ_DESKTOP_IDLE_SECONDS", 180)
    desktop_click_delay_ms: int = _int_env("BOZZ_DESKTOP_CLICK_DELAY_MS", 160)
    desktop_position_x: float = _float_env("BOZZ_DESKTOP_POSITION_X", 0.0)
    desktop_position_y: float = _float_env("BOZZ_DESKTOP_POSITION_Y", 0.0)
    desktop_allowlist_path: str = os.getenv("BOZZ_DESKTOP_ALLOWLIST", "")

    @property
    def tts_configured(self) -> bool:
        return bool(self.elevenlabs_api_key.strip() and self.elevenlabs_voice_id.strip())

    @property
    def workspace_dir(self) -> Path:
        return self.data_dir / self.workspace_dirname

    @property
    def database_path(self) -> Path:
        return self.data_dir / self.database_filename


def load_settings() -> Settings:
    """Build Settings from the current environment (no secrets are stored)."""
    return Settings()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()


settings = get_settings()
