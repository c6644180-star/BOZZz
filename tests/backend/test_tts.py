import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.ai.elevenlabs import (
    ElevenLabsTTS,
    TTSAuthError,
    TTSNotConfiguredError,
    TTSQuotaError,
    TTSTooLongError,
    TTSUpstreamError,
    split_for_speech,
)
from app.api import tts as tts_api
from app.core.config import Settings
from app.main import app

SECRET = "test-secret-value"


def client(**overrides) -> ElevenLabsTTS:
    base = {
        "elevenlabs_api_key": SECRET,
        "elevenlabs_voice_id": "test-voice",
        "tts_chunk_chars": 40,
        "tts_max_total_chars": 200,
        "elevenlabs_base_url": "https://api.elevenlabs.io/v1",
    }
    base.update(overrides)
    return ElevenLabsTTS(Settings(**base))


class ChunkingTests(unittest.TestCase):
    def test_short_text_is_single_chunk(self):
        self.assertEqual(split_for_speech("Hello there.", 500), ["Hello there."])

    def test_long_text_is_split_within_limit(self):
        text = (
            "This is the first sentence. This is the second sentence with more words. "
            "And a third one follows here. Finally a fourth sentence closes the reply."
        )
        chunks = split_for_speech(text, 40)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 40 for chunk in chunks), chunks)
        rebuilt = " ".join(chunks).replace("  ", " ")
        self.assertEqual(" ".join(rebuilt.split()), " ".join(text.split()))

    def test_single_word_longer_than_limit_is_hard_split(self):
        chunks = split_for_speech("x" * 95, 40)
        self.assertEqual([len(chunk) for chunk in chunks], [40, 40, 15])

    def test_whitespace_only_is_empty(self):
        self.assertEqual(split_for_speech("   \n\t "), [])


class ClientTests(unittest.TestCase):
    def test_unconfigured_status_and_error(self):
        tts = client(elevenlabs_api_key="", elevenlabs_voice_id="")
        self.assertFalse(tts.status()["configured"])
        with self.assertRaises(TTSNotConfiguredError):
            tts.synthesize("Hello.")

    def test_status_never_contains_the_key(self):
        tts = client()
        status = tts.status()
        self.assertTrue(status["configured"])
        self.assertNotIn(SECRET, repr(status))
        self.assertNotIn(SECRET, repr(Settings(elevenlabs_api_key=SECRET)))

    def test_long_reply_is_posted_in_chunks(self):
        tts = client(tts_chunk_chars=40)
        seen: list[str] = []

        def fake_post(chunk: str) -> bytes:
            seen.append(chunk)
            return b"mp3"

        with patch.object(tts, "_post", side_effect=fake_post):
            audio = tts.synthesize("A" * 30 + ". " + "B" * 30 + ". " + "C" * 20 + ".")

        self.assertGreater(len(seen), 1)
        self.assertTrue(all(len(chunk) <= 40 for chunk in seen))
        self.assertEqual(audio, b"mp3" * len(seen))

    def test_total_limit_is_enforced(self):
        tts = client(tts_max_total_chars=10)
        with self.assertRaises(TTSTooLongError):
            tts.synthesize("This sentence is much longer than ten characters.")


class RouteTests(unittest.TestCase):
    def test_routes_are_registered(self):
        paths = {route.path for route in app.routes if hasattr(route, "path")}
        for route in app.routes:
            router = getattr(route, "original_router", None)
            if router:
                paths.update(child.path for child in router.routes if hasattr(child, "path"))
        self.assertIn("/tts", paths)
        self.assertIn("/tts/status", paths)

    def test_status_route_exposes_no_secret(self):
        tts = client()
        with patch.object(tts_api, "get_tts", return_value=tts):
            status = tts_api.tts_status()
        self.assertTrue(status["configured"])
        self.assertNotIn(SECRET, repr(status))
        self.assertNotIn("api_key", status)

    def test_missing_config_returns_503(self):
        tts = client(elevenlabs_api_key="", elevenlabs_voice_id="")
        with patch.object(tts_api, "get_tts", return_value=tts):
            with self.assertRaises(HTTPException) as caught:
                tts_api.synthesize(tts_api.TTSRequest(text="Hello."))
        self.assertEqual(caught.exception.status_code, 503)

    def test_upstream_errors_map_to_json_statuses(self):
        cases = [
            (TTSAuthError("bad key"), 502),
            (TTSQuotaError("quota"), 429),
            (TTSUpstreamError("down"), 503),
            (TTSTooLongError("long"), 400),
        ]
        for exception, expected in cases:
            with self.subTest(exception=type(exception).__name__):
                tts = client()
                with patch.object(tts, "synthesize", side_effect=exception):
                    with patch.object(tts_api, "get_tts", return_value=tts):
                        with self.assertRaises(HTTPException) as caught:
                            tts_api.synthesize(tts_api.TTSRequest(text="Hello."))
                self.assertEqual(caught.exception.status_code, expected)

    def test_success_returns_mpeg_audio(self):
        tts = client()
        with patch.object(tts, "synthesize", return_value=b"ID3fake"):
            with patch.object(tts_api, "get_tts", return_value=tts):
                response = tts_api.synthesize(tts_api.TTSRequest(text="Hello."))
        self.assertEqual(response.media_type, "audio/mpeg")
        self.assertEqual(response.body, b"ID3fake")


if __name__ == "__main__":
    unittest.main()
