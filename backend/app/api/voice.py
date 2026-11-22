from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.voice.stream import (
    WakeWordScoreGate,
    allowed_wake_word_origin,
    is_loopback_client,
    pcm16_mono_frame,
)
from app.voice.wake_word import LocalWakeWordDetector, wake_word_model_status

router = APIRouter(prefix="/voice", tags=["voice"])


@router.get("/wake-word/status")
def wake_word_status() -> dict[str, object]:
    """Cheap diagnostics only; does not load a model or access audio devices."""
    return wake_word_model_status(validate=False)


@router.post("/wake-word/validate")
def validate_wake_word_model() -> dict[str, object]:
    """Explicitly load-check the configured ONNX file; never captures audio."""
    return wake_word_model_status(validate=True)


@router.websocket("/wake-word/stream")
async def wake_word_stream(websocket: WebSocket) -> None:
    """Accept short-lived local PCM frames only after an explicit consent handshake.

    Audio is processed in memory and never written to disk or sent to a cloud
    service. A detection ends the stream; the client must stop its microphone.
    """
    origin = websocket.headers.get("origin")
    client_host = websocket.client.host if websocket.client else None
    if not allowed_wake_word_origin(origin) or not is_loopback_client(client_host):
        await websocket.close(code=1008, reason="Local BOZZ renderer required.")
        return

    await websocket.accept()
    detector: LocalWakeWordDetector | None = None
    try:
        try:
            handshake = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        except asyncio.TimeoutError:
            await websocket.send_json({"type": "error", "message": "Start handshake timed out."})
            await websocket.close(code=1008)
            return

        if not isinstance(handshake, dict) or handshake.get("type") != "start" or handshake.get("consent") is not True:
            await websocket.send_json({"type": "error", "message": "Explicit background-listening consent is required."})
            await websocket.close(code=1008)
            return

        try:
            detector = await asyncio.to_thread(LocalWakeWordDetector.load)
        except Exception:
            await websocket.send_json({"type": "error", "message": "The configured local wake-word model could not be loaded."})
            await websocket.close(code=1011)
            return

        gate = WakeWordScoreGate()
        await websocket.send_json({
            "type": "ready",
            "sample_rate": 16000,
            "frame_samples": 1280,
            "audio_stored": False,
            "audio_uploaded": False,
            "model_version": detector.model_version,
        })

        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("bytes")
            if raw is None:
                if message.get("text") == "stop":
                    break
                await websocket.send_json({"type": "error", "message": "Only binary PCM audio frames are accepted."})
                await websocket.close(code=1003)
                break
            try:
                samples = pcm16_mono_frame(raw)
            except ValueError as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
                await websocket.close(code=1003)
                break

            scores = await asyncio.to_thread(detector.score_frame, samples)
            score = max((float(value) for value in scores.values()), default=0.0)
            if gate.update(score):
                await websocket.send_json({
                    "type": "wake_detected",
                    "score": round(score, 4),
                    "next_step": "The BOZZ window can be restored. Press the mic button to speak.",
                })
                break
    except WebSocketDisconnect:
        pass
    finally:
        if detector is not None:
            await asyncio.to_thread(detector.stop)
