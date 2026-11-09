from __future__ import annotations

from urllib import error, parse, request
import json
import re

from app.core.config import Settings

__all__ = [
    "ElevenLabsTTS",
    "TTSError",
    "TTSNotConfiguredError",
    "TTSTooLongError",
    "TTSAuthError",
    "TTSQuotaError",
    "TTSUpstreamError",
    "split_for_speech",
]


class TTSError(Exception):
    """Base class for speech synthesis failures."""


class TTSNotConfiguredError(TTSError):
    pass


class TTSTooLongError(TTSError):
    pass


class TTSAuthError(TTSError):
    pass


class TTSQuotaError(TTSError):
    pass


class TTSUpstreamError(TTSError):
    pass


_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+")


def split_for_speech(text: str, limit: int = 500) -> list[str]:
    """Split text into chunks of at most `limit` characters.

    Prefers sentence boundaries, then word boundaries, then a hard split for
    single tokens longer than the limit.
    """
    if limit < 1:
        raise ValueError("limit must be positive")
    normalized = " ".join(text.split())
    if not normalized:
        return []
    if len(normalized) <= limit:
        return [normalized]

    chunks: list[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current:
            chunks.append(current)
            current = ""

    for sentence in _SENTENCE_BREAK.split(normalized):
        if len(sentence) <= limit:
            if not current:
                current = sentence
            elif len(current) + 1 + len(sentence) <= limit:
                current = f"{current} {sentence}"
            else:
                flush()
                current = sentence
            continue

        flush()
        for word in sentence.split(" "):
            while len(word) > limit:
                chunks.append(word[:limit])
                word = word[limit:]
            if not word:
                continue
            if not current:
                current = word
            elif len(current) + 1 + len(word) <= limit:
                current = f"{current} {word}"
            else:
                flush()
                current = word

    flush()
    return chunks


class ElevenLabsTTS:
    """Minimal ElevenLabs client using the standard library only."""

    provider_name = "elevenlabs"

    def __init__(self, settings: Settings):
        self._api_key = settings.elevenlabs_api_key.strip()
        self._voice_id = settings.elevenlabs_voice_id.strip()
        self._model_id = settings.elevenlabs_model_id
        self._base_url = settings.elevenlabs_base_url.rstrip("/")
        self._chunk_chars = settings.tts_chunk_chars
        self._max_total_chars = settings.tts_max_total_chars
        self._timeout = settings.tts_timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self._api_key and self._voice_id)

    def status(self) -> dict[str, object]:
        return {
            "provider": self.provider_name,
            "configured": self.configured,
            "voice_configured": bool(self._voice_id),
            "model": self._model_id,
            "max_chars": self._chunk_chars,
            "max_total_chars": self._max_total_chars,
        }

    def synthesize(self, text: str) -> bytes:
        if not self.configured:
            raise TTSNotConfiguredError(
                "ElevenLabs is not configured. Set ELEVENLABS_API_KEY and "
                "ELEVENLABS_VOICE_ID in backend/.env, then restart the backend."
            )
        stripped = text.strip()
        if len(stripped) > self._max_total_chars:
            raise TTSTooLongError(
                f"Text is too long for speech (max {self._max_total_chars} characters)."
            )

        chunks = split_for_speech(stripped, self._chunk_chars)
        audio = b"".join(self._post(chunk) for chunk in chunks)
        if not audio:
            raise TTSUpstreamError("ElevenLabs returned no audio for this text.")
        return audio

    def _post(self, chunk: str) -> bytes:
        voice = parse.quote(self._voice_id, safe="")
        url = f"{self._base_url}/text-to-speech/{voice}?output_format=mp3_44100_128"
        payload = {
            "text": chunk,
            "model_id": self._model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        req = request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
                "xi-api-key": self._api_key,
            },
        )
        try:
            with request.urlopen(req, timeout=self._timeout) as response:
                return response.read()
        except error.HTTPError as exc:
            if exc.code in (401, 403):
                raise TTSAuthError(
                    "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY in backend/.env."
                ) from exc
            if exc.code in (402, 429):
                raise TTSQuotaError(
                    "ElevenLabs quota or rate limit reached. Try again later."
                ) from exc
            if exc.code in (400, 404, 422):
                raise TTSUpstreamError(
                    f"ElevenLabs rejected the request (HTTP {exc.code}). "
                    "Check ELEVENLABS_VOICE_ID in backend/.env."
                ) from exc
            raise TTSUpstreamError(f"ElevenLabs returned HTTP {exc.code}.") from exc
        except error.URLError as exc:
            raise TTSUpstreamError("ElevenLabs is not reachable from this device.") from exc
        except TimeoutError as exc:
            raise TTSUpstreamError("ElevenLabs took too long to respond.") from exc
