# BOZZ local wake-word foundation

## Current behavior

- Push-to-talk/manual microphone actions remain the supported voice paths.
- Selecting wake-word mode does not open a microphone.
- BOZZ ships no trained `BOZZ` wake-word model and does not silently use a cloud or browser speech service as a fallback.
- The backend diagnostics endpoints below inspect an optional model file only. They never open a microphone, record audio, or download a model.

## Optional model configuration

Set `BOZZ_WAKE_WORD_MODEL` in `backend/.env` to the absolute path of a compatible ONNX model, for example:

```dotenv
BOZZ_WAKE_WORD_MODEL=C:\\Users\\YourUser\\AppData\\Local\\BOZZ\\models\\bozz.onnx
```

The default installation does not install ONNX Runtime or download model weights. Install a compatible ONNX Runtime version into the backend environment only when you are ready to test a model. Keep the dependency optional so normal BOZZ startup remains lightweight.

## Diagnostics

- `GET /voice/wake-word/status` checks configuration, file existence, and whether `onnxruntime` can be imported. It does not load the model.
- `POST /voice/wake-word/validate` explicitly asks ONNX Runtime to load the configured model using the CPU provider. This can consume additional RAM, so run it manually rather than at startup.

A successful validation means only that ONNX Runtime can load the ONNX file. It does **not** prove that the model detects the phrase `BOZZ`, has acceptable false-activation rates, or is suitable for continuous use. Those require a separate labelled audio evaluation and a user-controlled real-device trial.

## Required gates before future microphone capture

1. Wake-word mode selected.
2. Explicit background-listening consent granted.
3. Windows microphone permission granted.
4. A compatible local wake-word model and inference adapter are installed and validated.
5. A visible tray indicator reports microphone activity, with a reliable pause/stop control.

No background microphone capture is implemented by this foundation. Do not treat model-file validation as permission to start listening.
