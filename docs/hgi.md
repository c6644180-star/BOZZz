# BOZZ HGI — Hand Gesture Intelligence

HGI is a local-only hand-tracking subsystem in the BOZZ frontend plus a
three-tier Desktop Control adapter in the Python backend. It adds three modes
(orb, in-page cursor, desktop control) on top of one camera pipeline and one
typed event bus. Desktop Control v2 is documented in
[desktop-control.md](desktop-control.md).

Everything ships in this repository. There are no cloud calls, no frame
uploads, and no recorded video. MediaPipe runs from files served by Vite.

## What is real

| Area | State |
| --- | --- |
| Landmark tracking | MediaPipe `HandLandmarker` (`@mediapipe/tasks-vision` 1.2.2), 2 hands, GPU with CPU fallback, ~20 fps cap |
| Filtering | One Euro filter per coordinate plus one-frame motion prediction |
| Calibration | 4 poses, adaptive ~10 s, stored in `localStorage` |
| Classifier | Nearest-centroid / k-NN over a 12-value feature vector, confidence per gesture |
| Taught gestures | Named feature samples (40), stored in IndexedDB, export/import JSON |
| Diagnostics | Camera-to-event latency, processing fps, tracking score, confidence, short-pinch counter |
| Session recording | Landmark numbers only, stored in IndexedDB; replay re-runs the same numbers |
| Gesture test | 20 prompted trials with real hit rate, false-trigger rate and average latency |
| Desktop control | WebSocket to FastAPI, three-tier allowlist enforced by the backend, Tier 2 approval, voice and gesture input, disabled by default, token + rate + confidence gates |
| Emergency stop | UI button, `Ctrl+Alt+Q` global hotkey, pyautogui corner fail-safe, “BOZZ stop” |

The built-in gestures are `point`, `pinch`, `two_hand_pinch`, `open_palm`,
`fist`, `two_finger_scroll`, `wrist_rotation`, `flick`, `claw`, and `clap`.
Recognition accuracy depends on lighting, camera placement, and calibration.
No accuracy number is displayed unless it came from a test you ran locally.

## Architecture

```
MediaPipeSource / ReplaySource        (landmarks/LandmarkSource.ts)
        │  LandmarkFrame
        ▼
HandFilterSet (One Euro + prediction) (filter/)
        │
        ▼
FeatureExtractor                      (features/features.ts)
        │  FeatureFrame (12 values per hand)
        ▼
PinchStateMachine + GestureClassifier (state/, classification/)
        │
        ▼
GestureBus (typed singleton)          (bus/GestureBus.ts)
   │        │          │
   ▼        ▼          ▼
OrbMode  CursorMode  DesktopMode      (modes/)
                        │
                        ▼
                 DesktopSocket → /ws/desktop → FastAPI DesktopController
                                                → pyautogui (mouse only)
```

`GestureEngine` (`engine/GestureEngine.ts`) is the only component that owns a
camera and a `HandLandmarker`. The HUD, preview, calibration wizard, and modes
all subscribe to the engine or the bus. Do not add a second camera pipeline.

The gesture loop never draws. It runs on `requestVideoFrameCallback` and
publishes CSS variables (`--hgi-orb-rotate`, `--hgi-orb-zoom`) that the orb
consumes on its own animation frame.

## LandmarkSource interface

```ts
interface LandmarkSource {
  readonly kind: 'camera' | 'replay'
  onFrame(listener: (frame: LandmarkFrame) => void): () => void
  onEnd(listener: () => void): () => void
  start(): Promise<void>
  stop(): void
  getStream(): MediaStream | null
  getVideo?(): HTMLVideoElement | null
}
```

`LandmarkFrame` carries `hands[]` (normalised image landmarks + world
landmarks + handedness + score), `timestamp`, `source`, and `latencyMs`.
`MediaPipeSource` pauses when the tab is hidden and resumes on return.
`ReplaySource` feeds recorded landmark numbers through the same filter and
classifier path so two filter settings can be compared on identical movement.

The MediaPipe files are local:

- `frontend/public/mediapipe/wasm/*`
- `frontend/public/mediapipe/hand_landmarker.task`

No CDN URL is used. If the files are missing, the engine reports a model error
instead of pretending to track.

## Event schema

All events are defined in `frontend/src/hgi/types.ts` and emitted through the
singleton `gestureBus`:

| Event | Payload |
| --- | --- |
| `gesture.move` | `{ hand, x, y, confidence, timestamp }` |
| `gesture.pinch_start` | `{ hand, x, y, confidence, timestamp, heldMs, clickAllowed }` |
| `gesture.pinch_hold` | same shape as `pinch_start` |
| `gesture.pinch_end` | same shape; `clickAllowed` is false when the hold was too short |
| `gesture.scroll` | `{ hand, delta, confidence, timestamp, gesture }` |
| `gesture.palm_pause` | `{ hand, confidence, timestamp, heldMs }` |
| `gesture.zoom` | `{ scale, confidence, timestamp, twoHandDistance }` |
| `gesture.rotate` | `{ hand, delta, confidence, timestamp }` |
| `gesture.flick` | `{ hand, direction, confidence, timestamp }` |
| `gesture.custom` | `{ name, confidence, timestamp, hand }` |
| `gesture.recognized` | `{ hand, name, confidence, timestamp, x, y, hands, heldMs, twoHandDistance }` |
| `hgi.diagnostics` | `HgiMetrics` |

Confidence is always the classifier's own value (0–1). Events below the
configured minimum confidence are not emitted as commands.

## Modes

- **Orb** — pinch + horizontal movement rotates; both hands pinched and moving
  apart/together zooms; the orb state follows real app state, not animation.
- **Cursor** — index fingertip drives a smoothed in-page cursor; pinch clicks;
  pinch-hold drags; two-finger scroll scrolls; open palm held 1 s pauses.
  Clicks on destructive controls (`data-gesture-guard` or danger words such as
  delete/remove/send/publish/approve/execute/reject) open a normal confirmation
  dialog instead of acting.
- **Desktop** — the same cursor point is sent to the backend, which maps it
  into a centred control rectangle and calls pyautogui. Desktop mode never
  controls the OS unless Desktop Control is explicitly turned on.

Desktop safety:

- OFF by default; requires the `device_control` grant, live gestures and a live
  WebSocket.
- Backend checks a random session token (generated at startup) with
  `secrets.compare_digest`, plus a localhost-only host check.
- Minimum confidence (default 0.7) and a rate limit (default 60 commands/s).
- Three tiers are enforced from `config/desktop_actions.json`: Tier 1 runs
  immediately, Tier 2 needs a fresh 10 s approval, Tier 3 is blocked with no
  override. The page cannot add actions.
- Auto-off when the tab is hidden for 10 s, tracking is lost for 2 s after a
  gesture action, the camera stops, the socket disconnects, or the idle timeout
  expires.
- Emergency stop latches until the backend restarts. `Ctrl+Alt+Q` (pynput),
  pyautogui's top-left corner fail-safe, the Stop button and “BOZZ stop” all
  trigger it.
- `data/desktop-actions.log` records desktop actions only (UTC timestamp +
  action). Dictated text is stored as a character count, never content. No
  camera or landmark data is written.

See [desktop-control.md](desktop-control.md) for every action id and tier.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `G` | Toggle gestures / camera |
| `M` | Cycle orb → cursor → desktop |
| `R` | Reset the orb rotation and zoom |
| `H` | Open the history panel |
| `P` | Pause or resume gesture commands |
| `Esc` | Close open panels and stop voice |
| `Ctrl+Alt+Q` | Global desktop emergency stop |

Gesture meanings (pinch, scroll, click, drag, pause, rotate) are configurable
in **Gesture Lab → Gesture settings**.

## Calibration

1. Turn gestures on.
2. Open **Gesture Lab → Calibration**.
3. Hold each prompted pose until the counter reaches the target:
   open palm, pinch, fist, relaxed.
4. The result stores pinch on/off thresholds and sample counts in
   `localStorage` (`bozz.hgi.calibration.v1`). Recalibrate whenever the
   lighting or camera position changes.

## Add a gesture

1. Add the name to `GestureName` and `BUILTIN_GESTURES` in
   `frontend/src/hgi/types.ts`.
2. Add a label to `GESTURE_LABELS` in
   `frontend/src/hgi/classification/builtinGestures.ts`.
3. Add a centroid to `BUILTIN_CENTROIDS` using the 12-value feature order
   documented at the top of that file, and, if needed, special-case logic in
   `GestureClassifier.classify`.
4. Add an event only if the existing generic events cannot express it; extend
   the typed `GestureEventMap` and emit it from `GestureEngine`.
5. Subscribe in the mode that needs it. Do not open the camera again.
6. Add a unit test for any pure logic (centroid distance, thresholds, mapping).

A taught gesture is simpler: **Gesture Lab → Teach a gesture**, enter a name,
hold the pose for 40 samples, test it live, then export/import JSON if you
want a backup.

## Diagnostics and honest limits

The diagnostics panel shows real values measured in this browser session:

- camera-to-event latency (EMA of MediaPipe presentation time to now),
- processing fps (capped by the Low/Medium/High quality profile),
- tracking score from MediaPipe,
- current gesture and classifier confidence,
- hand count, pinch events, short-pinch false-click counter,
- whether the optional microphone clap gate is active.

`clap` is reported with low confidence unless the microphone level spikes and
you granted microphone permission. Audio is never stored or transmitted.

Recording a session stores landmark numbers only. Replay slows or speeds the
numbers, never a video. A gesture test measures the gesture you selected over
20 prompted trials; a cancellation saves nothing.

## Performance notes (Intel i3, 8 GB)

- Inference rate is capped per quality profile; Low is best on integrated
  graphics.
- The preview is drawn on a canvas at a reduced size; processing is separate
  from the orb's render loop.
- The camera is released when gestures are switched off or the page is hidden.
- Camera preview is optional; the engine runs without rendering the video.
- Filtering updates typed arrays in place where possible; the per-frame feature
  and classification work uses small short-lived arrays.

## Tests

```powershell
cd frontend
npm test
```

Covers One Euro filtering, pinch hysteresis/lost-hand grace, coordinate and
control-rectangle mapping, and classifier behaviour.

```powershell
cd backend
..\.venv\Scripts\python.exe -m unittest discover -s ../tests/backend
```

Covers the backend contract, plus desktop control v2: tiers, allowlist and URL
checks, typed parameters, rate limit, coordinate mapping, auto-disable rules,
emergency latch, dictation guards, the voice grammar and Intent Map stages.
See [desktop-control.md](desktop-control.md).

## Known limitations

- Gesture accuracy has not been benchmarked on a fixed rig; it depends on
  your camera, lighting, distance, and calibration.
- MediaPipe numeric results differ slightly between GPU and CPU delegates.
- The desktop adapter controls the whole Windows desktop; test with Notepad
  first and keep the pointer away from the top-left corner (fail-safe).
- The frontend fallback URL `ws://127.0.0.1:8000` is used outside localhost
  (for example packaged Electron) and assumes the backend runs on the same
  machine.
