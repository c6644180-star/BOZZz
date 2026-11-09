# Mini Orb mode (Electron desktop app)

Mini Orb turns BOZZ into a small floating orb on top of your other windows while
the full window is hidden. It is available **only in the Electron desktop app**.
In a normal browser the top-bar button is hidden, the `/mini` route only shows
“Mini mode needs the desktop app.”, and Settings shows the same note.

Nothing here is a mock: the mini window renders the real voice state, real mic
and camera indicators and real desktop-control/approval state published by the
main (hidden) window.

## What the two windows do

| Window | Size | Job |
| --- | --- | --- |
| Main window | normal | Owns microphone, speech recognition, TTS, camera/gesture engine, chat, approvals. Hidden (not closed) in mini mode and keeps running. |
| Mini window | 240×250 (or 320×320 “medium”) | Frameless, transparent, always-on-top, no taskbar entry, shown **inactive** (it does not steal focus). It only displays orb state and sends small actions back. |

There is only one camera/mic pipeline: the mini window never opens a sensor.

## Enter and leave

- Top-bar **minimize button** (Electron only)
- `Ctrl+Alt+M`
- Voice/typed: “minimize”, “mini mode”, “mini orb”, “enter mini mode”, “go mini”
- Leave with `Ctrl+Alt+M`, a single click on the orb (expand), or “maximize”,
  “full mode”, “full screen”, “exit mini”, “restore window”.

“Minimize” in a browser answers “Mini mode needs the desktop app.” and does
nothing else.

## Controls on the orb

| Action | Result |
| --- | --- |
| Single click | Back to the full window |
| Double click | Start/stop quick voice listening (same mic as full mode) |
| Right click | Native menu: Open full mode, Mute mic, Stop speaking, Quit |
| Drag | Moves the orb; wandering pauses for 60 s |
| Hover | Only the orb circle, flags, caption and approval card catch the mouse; transparent pixels stay click-through |

Keyboard while the mini window has focus (click it once): `Ctrl+Alt+Q`
emergency stop, and the configured push-to-talk key (`Space`, `Ctrl+Space` or
`Alt+Space`) for hold-to-talk.

## What keeps working in mini mode

- Voice input (push-to-talk and the optional “BOZZ” wake prefix), the gold ring
  whenever the mic is really listening, and the mic flag.
- Spoken commands follow the normal pipeline (UNDERSTAND → PLAN → APPROVE →
  EXECUTE → VERIFY → REPORT) because the hidden main window does the routing.
- Desktop control approvals appear as a small card next to the orb (Approve /
  Deny) with the real server timeout capped at 10 s; at zero it denies itself.
  Voice approval still works through the existing approval flow.
- Desktop control keeps its red “Desktop ON” flag and audit behaviour. Emergency
  stop (`Ctrl+Alt+Q`, “BOZZ stop”, or the red orb state) works in mini mode.
- If gesture control was already running it keeps running: the camera pipeline
  is exempted from the hidden-window pause and presence is reported as visible
  so the backend's 10 s auto-disable does not fire. The camera is **never**
  started just because you entered mini mode.

## Settings → “Mini orb”

Wander on/off, wander speed (Slow/Normal), dock (free or a corner), size
(Small/Medium), which display to use (follow cursor / primary), opacity
(0.35–1), pause on battery, plus a **Test mini mode** button. Values are stored
with the rest of the local settings (`bozz.settings`).

## Pause rules

The orb stops animating (and wandering stops) when:

- wandering is off (docking counts as off),
- you dragged it in the last 60 s,
- a desktop-control approval is waiting,
- the system has been idle for 180 s (skipped while listening/speaking),
- BOZZ's own window is fullscreen,
- the laptop is on battery (setting on by default).

## CPU on the target laptop

Measured on the i3/8 GB Windows test machine (Electron 45, dev Vite build, CDP
attached), all Electron processes together, 10 s samples:

| State | Total CPU | Main hidden renderer |
| --- | --- | --- |
| Mini active, docked, orb idle animation (12 fps) | ~2.8 % | ~0 % |
| Mini active, wandering on (default) | ~4.1 % | ~1 % |
| Mini visible but paused (system idle) | ~2 % | ~0 % |

Two things make this possible: while mini mode is on, the hidden main window's
CSS animations are frozen (`html[data-mini-background]`), and the mini orb runs
at 12 fps while idle, switching to the 30 fps cap for listening/thinking/
speaking/error.

Memory: ~170 MB mini renderer, ~200 MB GPU process, ~100 MB main process.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote
  module; both windows load only the local app URL and deny new windows,
  webviews and navigation away from it.
- The preload exposes only: `setMode`, `getMode`, `openFull`, `quit`,
  `publishMiniState`, `publishMiniConfig`, `sendMiniAction` and the matching
  `onMini*` subscriptions.
- Every IPC message is sanitised in `frontend/electron/mini/ipc.cjs` (known
  action types, clamped drag coordinates, approval ids limited to
  `[A-Za-z0-9_-]{1,128}`, captions cut at 600 chars, bounded tier/timeout,
  config choices whitelisted) and only the main window may publish state.
- Mini mode never captures the keyboard or screen and never reads other windows.
  It cannot hide from the task manager: the process is a normal Electron app.

## Known limits (things that do not work or are untested)

- Exclusive-fullscreen games and the Windows secure desktop (UAC, lock screen)
  stay above the orb; Windows does not let normal always-on-top windows cover
  them.
- Fullscreen detection only looks at BOZZ's own windows. If another app goes
  fullscreen, the orb will not pause itself for that reason.
- “Pause on battery” uses the Windows power state (on battery), not the
  “battery saver” flag. There is no separate battery-saver check.
- `Ctrl+Alt+Q` is also registered by the desktop-control backend when it is on;
  in that case the backend owns the shortcut and the mini window's extra
  registration silently fails (the emergency stop still works).
- The mini window is shown without focus, so push-to-talk keys only reach it
  after you click the orb once.
- Running only in Chrome, nothing floats over other apps; the page just shows
  the fallback note.
- Voice recognition, approval popups, right-click menu, drag and gesture
  continuity were **not** exercised by hand with a real microphone/camera in
  this round. Unit tests (43 cases) and the Electron smoke tests below cover the
  logic, geometry, IPC and window behaviour only.

## How it was checked

Automated (Vitest, `npm test`):

- `src/mini/__tests__/wander.test.ts` — random targets and dock points always
  inside the display work area, never over a 40 px taskbar, including negative
  and above-origin monitors.
- `src/mini/__tests__/mode.test.ts` — full → mini → full, mic/camera preserved,
  malformed events ignored.
- `src/mini/__tests__/ipc.test.ts` — mode/action/state/config validation.
- `src/mini/__tests__/pause.test.ts` — every pause reason, busy exemption.

Live Electron smoke test (remote debugging, one instance):

- `BOZZ_START_MINI=1` started directly in mini mode: mini target appears, main
  window hidden at the OS level (`IsWindowVisible` false), only one visible
  window.
- `setMode('full')` closes the mini window and shows the main window;
  `setMode('mini')` recreates it. Main orb pauses while hidden and resumes.
- Mini window measured 240×250 inside the 1366×728 work area while wandering,
  never on the taskbar.
- `WS_EX_TRANSPARENT` on the mini window toggles off when the pointer is over
  the orb and back on over a transparent corner.
- Typed “minimize” → mini opens; typed “maximize” → full window returns.
- Settings shows the Mini orb section without the browser note; in Chrome the
  note appears, the Test button is gone, the top-bar button is gone and `/mini`
  shows the fallback text.
- Idle pause observed: after 3 minutes without input the mini orb reported
  `data-paused="true"`; a real (SendInput) mouse nudge resumed it.

## Run it

```powershell
# Terminal 1
cd "C:\Users\Marimuthu S\Documents\GitHub\BOZZz\frontend"
npm run dev

# Terminal 2 (same folder)
npm run electron
```

Then click the small minimize button in the top bar, or press `Ctrl+Alt+M`.
Start directly in mini mode (PowerShell):

```powershell
$env:BOZZ_APP_URL="http://localhost:5173"; $env:BOZZ_START_MINI="1"; npm run electron
```
