# BOZZ local wake-word foundation

## Current behavior

- Push-to-talk/manual microphone actions remain the supported voice paths.
- Selecting wake-word mode does not open a microphone.
- BOZZ ships no trained `BOZZ` wake-word model and does not silently use a cloud or browser speech service as a fallback.
- The local detector accepts audio frames supplied by a future, separately permission-gated capture service. The detector itself has no microphone/device code and never starts a capture stream.

## Optional installation

The normal backend requirements do not include wake-word dependencies. When you are ready to test a compatible model, install the optional package from the backend directory:

```powershell
python -m pip install -r requirements-wakeword.txt
```

This installs openWakeWord 0.6.0 and its runtime dependencies. On Windows, the upstream package may also install PyAudioWPatch as an audio-input dependency; BOZZ's current detector does not use it or open an audio device.

## Local model assets

Set all three absolute paths in `backend/.env`:

```dotenv
BOZZ_WAKE_WORD_MODEL=C:\\Users\\YourUser\\AppData\\Local\\BOZZ\\models\\bozz.onnx
BOZZ_WAKE_WORD_MELSPEC_MODEL=C:\\Users\\YourUser\\AppData\\Local\\BOZZ\\models\\melspectrogram.onnx
BOZZ_WAKE_WORD_EMBEDDING_MODEL=C:\\Users\\YourUser\\AppData\\Local\\BOZZ\\models\\embedding_model.onnx
```

The first file must be a classifier trained for the phrase `BOZZ`. The other two are openWakeWord's audio feature models. BOZZ does not download these assets automatically, and a stock model for a different phrase must not be relabelled as `BOZZ`.

## Diagnostics and validation

- `GET /voice/wake-word/status` checks whether all three paths exist and whether optional runtime packages can be imported. It does not instantiate the model.
- `POST /voice/wake-word/validate` explicitly constructs the openWakeWord inference pipeline on CPU. This may consume additional RAM, so run it manually rather than at startup.
- `LocalWakeWordDetector.score_frame(...)` accepts only mono 16 kHz signed 16-bit PCM frames of 1,280 samples (80 ms) and returns model scores. It does not choose a threshold, invoke actions, or capture audio.

A successful validation means only that the configured model pipeline loads. It does **not** prove that the model detects `BOZZ` accurately or has an acceptable false-activation rate. Those require a separate labelled audio evaluation and user-controlled real-device trial.

## Required gates before future microphone capture

1. Wake-word mode selected.
2. Explicit background-listening consent granted.
3. Windows microphone permission granted.
4. A compatible local classifier and feature models are installed and validated.
5. A visible tray indicator reports microphone activity, with a reliable pause/stop control.

No background microphone capture is implemented by this foundation. Do not treat model-file validation as permission to start listening.

## Upstream references

- openWakeWord usage and frame input format: https://github.com/dscripka/openWakeWord
- openWakeWord package metadata and Windows dependencies: https://github.com/dscripka/openWakeWord/blob/main/setup.py
