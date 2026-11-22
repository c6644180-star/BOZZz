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


## Settings diagnostics panel

The Settings page now includes a local wake-word setup panel:

- It calls the cheap status endpoint to show whether the three explicitly configured ONNX files exist and whether their file formats are supported.
- It shows filenames only; absolute model paths are not displayed in the UI.
- **Validate local model** requires a separate confirmation and calls the explicit CPU load-check endpoint.
- The panel reports runtime availability, whether model loading succeeded, and the backend's microphone-opened flag.
- Validation is not performed automatically at application startup. It does not open the microphone, record audio, download assets, or start background listening.

A loadable model is not an accuracy result. The classifier must actually be trained for the phrase “BOZZ” and evaluated on labelled positive and negative audio before any capture pipeline can be enabled.

## Required gates before future microphone capture

1. Wake-word mode selected.
2. Explicit background-listening consent granted.
3. Windows microphone permission granted.
4. A compatible local classifier and feature models are installed and validated.
5. A visible tray indicator reports microphone activity, with a reliable pause/stop control.

No background microphone capture is implemented by this foundation. Do not treat model-file validation as permission to start listening.


## Gate 7 — permission-controlled local microphone stream

The desktop Settings panel can start a real-time local detector session only when all of these conditions are met:

1. The user has enabled **Allow future background listening** in Settings.
2. The user separately clicks **Start local wake-word listener** and confirms the prompt.
3. The configured classifier and both feature models passed the explicit load check.
4. The local BOZZ backend accepts a WebSocket handshake from the loopback desktop renderer.
5. The operating system grants microphone access to BOZZ.

The backend is loaded before BOZZ requests microphone permission. The desktop renderer then requests a mono audio stream, creates a 16 kHz audio context, and sends 80 ms signed 16-bit PCM frames to `127.0.0.1:8000`. The WebSocket accepts only the configured local renderer origins and loopback clients. It requires an explicit consent handshake and rejects non-binary or incorrectly sized audio frames.

Audio frames are processed in memory by the local ONNX detector. BOZZ does not write the stream to disk, upload it, or send it to a cloud speech provider. The current detector uses a 0.5 score threshold and two consecutive qualifying frames; these are experimental defaults, not a reliability guarantee.

On detection, the server ends the stream. BOZZ releases the microphone, restores the main window, and shows a notification. It does **not** start command recording or execute an action. The user must press the mic button to speak. The user can stop listening from Settings or from the system tray. Disabling the background-listening consent preference also stops an active session.

The tray shows microphone activity while this listener is active. Electron disables background throttling only for the explicitly active session. A renderer crash clears the tray status; OS track termination and backend disconnection stop the client capture.

### Windows manual acceptance for Gate 7

1. Install the optional wake-word runtime and configure the three ONNX paths in `backend/.env`. The classifier must genuinely be trained for “BOZZ”; do not rename a classifier for another phrase.
2. Start BOZZ and open Settings. Enable **Allow future background listening**.
3. Run **Validate local model**. Do not continue unless it reports that the engine loaded.
4. Click **Start local wake-word listener** and confirm. Grant Windows microphone permission when prompted.
5. Verify the tray says **Microphone: ACTIVE** and the Settings panel says **LISTENING**.
6. Hide BOZZ to the tray. Speak the test phrase and check whether the window restores. On detection, verify the microphone indicator turns off.
7. Verify the microphone remains off until you press the normal mic button.
8. Start again, then stop from the tray. Confirm the tray changes to **Microphone: off** and Windows no longer shows BOZZ using the microphone.
9. Repeat by disabling background-listening consent and by closing BOZZ. Both paths must stop capture.
10. Test false activations and missed detections in a quiet room and with normal background noise. Record only labelled test outcomes; do not assume two-frame triggering means production accuracy.

The streaming pipeline is a development feature and must remain disabled unless the local model is trained and evaluated. CI can test guards and score logic, but cannot validate a physical microphone, Windows permission prompts, acoustic performance, or actual wake-word accuracy.

## Upstream references

- openWakeWord usage and frame input format: https://github.com/dscripka/openWakeWord
- openWakeWord package metadata and Windows dependencies: https://github.com/dscripka/openWakeWord/blob/main/setup.py
