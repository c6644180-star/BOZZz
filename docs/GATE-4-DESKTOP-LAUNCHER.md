# Gate 4 — Desktop App and Window Intelligence

## Included: fixed app launcher

BOZZ's native tray offers explicit menu actions for Calculator, Notepad and Paint on Windows. The launcher uses a fixed executable allowlist and starts each application with an empty argument list, `shell: false`, and detached stdio. No command text, path, or arguments are accepted from the renderer or an AI model.

The Settings page includes an in-app launcher. Each button asks the user to confirm, then invokes a narrow preload bridge. The main process validates the sender and app ID again before launching. In a browser, the controls are unavailable. No AI/chat pathway is connected to this IPC handler.

## Included: BOZZ-owned window intelligence

The Settings page can list and focus only BOZZ-owned windows (the main BOZZ window and optional mini orb). It returns fixed IDs and limited state metadata. Focus accepts only `main` or `mini`, and the UI asks for confirmation first.

## Included: external application intelligence

On Windows, the Settings page can discover visible top-level windows belonging to this fixed process allowlist:

- Notepad (`notepad`)
- Paint (`mspaint`)
- Calculator (`calculatorapp` / `calc`)
- Microsoft Edge (`msedge`)
- Google Chrome (`chrome`)
- Visual Studio Code (`code`)

Discovery is performed by a fixed, non-interactive PowerShell script launched without a shell. No user-provided command, path, process name, or argument is accepted. The renderer receives only an opaque, one-use ID and a friendly app label. Native window handles remain in the Electron main process.

The inventory deliberately does not return window titles, browser-tab titles, document names, process IDs, screenshots, or application contents. A user must confirm each focus request. The native focus action restores the selected window and asks Windows to bring it forward; Windows may deny foreground activation. A fresh scan is required after a focus attempt because each ID is single-use.

## Security and privacy boundaries

- Windows only; other platforms report that external discovery/focus is unavailable.
- Discovery is limited to the explicit process allowlist above. Unknown apps are ignored.
- No titles or application contents are read or sent to the renderer.
- Native handles are not exposed to the renderer and are accepted only from the current in-memory scan.
- Focus tokens expire on refresh and are consumed on use.
- PowerShell is invoked with fixed source text, no profile, no interactive prompt, a timeout, and no shell. No user text is interpolated into the script; the only value added to the focus script is a validated numeric handle obtained from Windows.
- This milestone does not type, click, read, close, or automate inside external apps.
- No arbitrary shell, terminal, executable path, or command execution is exposed.
- External application discovery is initiated by the Settings panel; it is not continuous background monitoring.

## Automated coverage

Tests cover the fixed app launcher, unsupported IDs/platforms, process-start errors, BOZZ window focus, supported external process filtering, metadata minimization, opaque IDs, malformed handle rejection, one-use focus tokens, and safe PowerShell failure handling. CI runs these tests and the frontend production build.

## Manual acceptance on Windows

1. Start BOZZ and confirm the tray menu still opens Calculator, Notepad and Paint only after a direct menu click.
2. Open Settings and scan supported apps.
3. Open Notepad, Paint, Calculator, Edge, Chrome or VS Code, then scan again. Only supported apps with a visible main window should appear.
4. Confirm the UI shows app labels only—not tab titles, document names, or window titles.
5. Select one app, confirm the prompt, and verify Windows brings that app forward when allowed.
6. Confirm an unknown app is not listed and that scanning does not start, close, type into, or otherwise control any app.
7. Close an app, refresh, and confirm it disappears from the inventory.
8. Verify non-Windows platforms display the unsupported message.


## Gate 5 — explicit background gesture lifecycle

When a user manually starts the Gesture Lab camera in the Electron desktop app, the renderer asks the trusted main process to disable background throttling for that BOZZ window. This keeps the existing local gesture pipeline responsive while BOZZ is hidden to the tray. It does not start the camera, microphone, or gesture engine automatically.

The tray camera status combines the gesture-camera state with the mini-orb state so one subsystem cannot accidentally hide the other's active indicator. While the gesture camera is active, the tray exposes **Stop camera & gestures**. Selecting it sends a narrow event to the main renderer, which stops the gesture engine, releases the camera stream and microphone gate, stops gesture modes, and switches background throttling back to normal (unless mini mode still needs it).

The Electron preload exposes only a boolean background-activity request and a stop-camera subscription. The main process accepts the request only from the trusted BOZZ main window. It does not accept commands, scripts, window handles, or arbitrary renderer data.

### Gate 5 manual acceptance on Windows

1. Start BOZZ, open Gesture Lab, and explicitly start gestures; grant camera permission only when prompted.
2. Confirm the tray tooltip/menu reports **Camera: ACTIVE**.
3. Hide BOZZ to the tray. Move a hand in front of the camera, then restore BOZZ and confirm the local hand-tracking metrics continue updating.
4. Open the tray menu and select **Stop camera & gestures**.
5. Confirm the camera preview stops, the camera indicator returns to off, and the gesture engine reports off.
6. Repeat while mini mode is active; stopping the gesture camera must not break the mini orb's own background lifecycle.
7. Quit BOZZ and confirm the process exits normally.

The camera is intentionally still active while hidden after the user has started it. The tray stop item is the quick off switch; quitting BOZZ also ends the stream. No hidden startup, wake-word listening, recording, or automatic gesture execution is introduced by this gate.


## Gate 7 — consent-controlled local wake-word stream

The Settings wake-word panel now includes a real local detector stream, gated by the explicit background-listening preference, a separate Start click/confirmation, a successfully loaded local model, and OS microphone permission. The backend is loaded before the microphone is requested. A loopback-only WebSocket accepts only the configured local renderer origins and exact 80 ms mono int16 frames.

The Electron main process exposes only narrow wake-word activity, show-main, and stop-listener IPC methods. While listening, the tray reports **Microphone: ACTIVE**, offers **Stop wake-word listener**, and the BOZZ main renderer runs without background throttling. A renderer crash clears the tray indicator. Detection closes the stream and microphone, restores BOZZ, and notifies the user; it does not automatically record a command or execute an action.

Audio is processed by the local backend in memory. No audio is written to disk or uploaded. The experimental threshold is 0.5 with two consecutive qualifying frames; false activations and misses remain possible. See `WAKE-WORD-FOUNDATION.md` for the complete privacy model and manual acceptance steps.

## Next increments

1. Add narrow app-specific keyboard/mouse actions only after a separate threat-model review, with per-action approval, visible execution state, cancellation, and verification.
2. Keep arbitrary command execution, hidden monitoring, and unrestricted control out of the renderer and AI tool surface.

Do not describe Gate 4 as full computer control until later automation increments are implemented and verified on the target Windows PC.
