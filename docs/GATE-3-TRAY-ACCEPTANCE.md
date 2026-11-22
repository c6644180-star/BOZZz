# Gate 3 — Desktop lifecycle, sensor privacy and local wake-word evaluation

## Implemented software foundations

- Electron creates a local tray icon, hides the main window on close, restores it from the tray, and exposes an explicit Quit action.
- Tray labels reflect renderer-reported microphone and camera activity. The tray does not activate either sensor.
- Electron exposes a read-only native microphone/camera permission status query to the main Settings window on Windows/macOS. It does not request permissions or activate devices; unsupported platforms report unavailable.
- Camera access is opt-in; camera shutdown releases media tracks. Microphone capture requires an explicit user action except for a future wake-word path that must pass all independent gates.
- Background listening is off by default. A saved consent preference is not itself microphone permission.
- The wake-word engine is reported unavailable until the user supplies the three local ONNX assets and installs the optional runtime.
- The backend status endpoint is read-only and does not load the model. Explicit validation loads the CPU inference pipeline but does not open an audio device.
- A frame-only local detector accepts mono 16 kHz signed 16-bit PCM frames (1,280 samples / 80 ms). It only returns scores; it cannot open a microphone or dispatch computer actions.
- The Wake-Word Model Lab CLI evaluates labelled local WAV clips and reports positive-clip recall, negative false activations per audio hour, inference wall-time/real-time factor, and Python-traced peak allocations. The memory metric excludes native ONNX Runtime allocations and is not total process RAM. It never records, uploads, or automatically downloads audio/model files.

## Wake-Word Model Lab

Optional dependency installation (run inside backend):

    python -m pip install -r requirements-wakeword.txt

Set paths to three ONNX assets supplied and licensed by the user:

    $env:BOZZ_WAKE_WORD_MODEL = "C:\\Models\\bozz.onnx"
    $env:BOZZ_WAKE_WORD_MELSPEC_MODEL = "C:\\Models\\melspectrogram.onnx"
    $env:BOZZ_WAKE_WORD_EMBEDDING_MODEL = "C:\\Models\\embedding_model.onnx"

Create a UTF-8 JSONL manifest. Paths are relative to the manifest file unless absolute; each line is one labelled clip:

    {"path":"positive/bozz_01.wav","label":"positive"}
    {"path":"negative/room_01.wav","label":"negative"}

WAV requirements: uncompressed mono, 16-bit PCM, 16 kHz. Then run:

    python scripts/evaluate_wake_word.py --manifest .\\wakeword-manifest.jsonl --threshold 0.5 --output .\\wakeword-report.json

Threshold and cooldown are evaluation parameters, not universal recommended settings. Include diverse, consented positive samples and long representative negative samples. Do not record other people without their permission. Keep the WAVs and report local. A small test set cannot establish real-world reliability; repeat evaluation across quiet, noisy and varied speaking conditions before considering background use.

## Required manual acceptance on Windows

1. Start BOZZ, verify tray icon appears, close the main window, and verify BOZZ remains in the tray.
2. Restore BOZZ from tray click and Open BOZZ.
3. Confirm idle tray state reports microphone off and camera off.
4. Enable camera explicitly in Gesture Lab, verify the tray reflects active state, stop the camera, and verify it returns to off.
5. Deny camera permission and verify a clear unavailable/denied state without a retry loop.
6. Use manual microphone input, verify the tray reports active only during capture, then off after completion.
7. Choose Quit BOZZ and verify the tray icon and process exit; restart BOZZ.
8. Verify the wake-word status endpoint reports missing assets honestly on a machine without configured models.
9. With user-supplied licensed model assets, run explicit model validation and the Model Lab CLI. Confirm no microphone device is opened during either operation.
10. Confirm the background-listening gate refuses start unless wake-word mode, BOZZ consent, installed engine and Windows microphone permission are all present.

## Not claimed / deferred

- No bundled BOZZ wake-word classifier or verified “BOZZ” phrase model is included.
- No claim of 100% wake-word detection, zero false activations, or reliable wake while the UI is closed.
- Native OS permission status is queried read-only through Electron on Windows/macOS. Verify the returned values against Windows Settings > Privacy & security > Microphone and Camera on the target PC; OS status is not proof that a device is currently active or that a particular browser capture will succeed.
- Tray sensor labels are renderer-reported status, not independent hardware telemetry.
- The current backend frame adapter is not connected to an audio capture device. Do not connect it to background capture until consent, native OS permission, lifecycle, performance and false-activation acceptance are verified.
- Windows tray lifecycle, camera-release and microphone permission behaviour require manual target-PC testing; CI cannot prove them.

## CI scope

CI checks syntax, imports, automated regression tests, Electron syntax, frontend tests and production build. It does not validate physical microphone/camera hardware, Windows notification-area behaviour, wake-word phrase accuracy or acoustic false-activation rates.
