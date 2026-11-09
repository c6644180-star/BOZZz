# BOZZ Desktop Control v2

Desktop Control v2 lets BOZZ drive this Windows PC from gestures, voice and the
UI — without giving the page or the AI free rein over the operating system.

- The page can **request** actions. The backend decides which action ids exist,
  which tier each one has, and whether it may run.
- Actions are defined in exactly one file: [`config/desktop_actions.json`](../config/desktop_actions.json).
  The frontend can never add, rename or re-tier an action.
- Gestures and voice consume the existing HGI event bus and the existing
  `/ws/desktop` bridge. There is no second camera pipeline and no second
  hand-tracking model.
- Everything runs on `127.0.0.1`. There are no cloud calls and no camera or
  audio data in any log.

## Safety model

| Rule | Behaviour |
| --- | --- |
| Default state | OFF. The `hgi` module asks for the `device_control` permission, which starts ungranted, and control is still OFF after the grant until you turn it on |
| Visible state | A persistent red **DESKTOP CONTROL ON** banner with the live state and an Emergency Stop button. The banner only exists while control is on or latched stopped |
| Emergency stop | Backend latched stop. Releases any held mouse button, clears pending approvals, stops dictation and disables control. Nothing runs again until the backend restarts |
| Stop inputs | Emergency Stop button in the banner and panel, global `Ctrl+Alt+Q` (pynput), pyautogui top-left corner fail-safe, and the voice command “BOZZ stop” |
| Auto-disable | Tab hidden for 10 s, tracking lost for 2 s after a gesture action, camera stopped, bridge socket disconnected, or no input for the configured idle time |
| Permissions | Every action and the WebSocket itself require the `device_control` grant. Revoking it stops the bridge immediately |
| Transport | Loopback only, random per-start session token compared with `secrets.compare_digest` |
| Schema | Every message is validated against a typed schema with bounded numbers and string lengths. Unknown ids and extra parameters are refused |
| Confidence | Gesture-driven actions below the backend confidence floor (default 0.7) are ignored |
| Rate limit | 60 actions per second by default. Excess actions are rejected and logged |
| Audit | `data/desktop-actions.log` records every executed, approved, rejected and blocked action. Dictated text is logged only as a character count |

The core rule is: **the frontend cannot escalate**. It can only name an existing
action id and its parameters. Paths, URLs, key combinations and free text are
re-checked in the backend on every request.

## Action tiers

### Tier 1 — runs immediately

| Action id | What it does | Verification |
| --- | --- | --- |
| `mouse.move` | Move the pointer inside the control area | Real pointer position read back |
| `mouse.click` | Left click | Pointer position |
| `mouse.double_click` | Double click | Pointer position |
| `mouse.right_click` | Right click | Pointer position |
| `mouse.drag_start` | Press and hold the left button | Pointer position |
| `mouse.drag_move` | Move while held | Pointer position |
| `mouse.drag_end` | Release the button | Always accepted, so a drag cannot stay held |
| `mouse.scroll` | Scroll, bounded to ±1200 per event | Not observable — reported “executed, not verified” |
| `volume.up` | Raise the volume | Reads the real level back |
| `volume.down` | Lower the volume | Reads the real level back |
| `volume.mute` | Mute or unmute | Reads the real mute state |
| `media.play_pause` | Media play/pause key | Not observable |
| `media.next` | Next track | Not observable |
| `media.previous` | Previous track | Not observable |
| `brightness.up` | Raise brightness | Only if the machine exposes it |
| `brightness.down` | Lower brightness | Only if the machine exposes it |
| `window.switch` | Alt+Tab | Active window title changes |
| `window.show_desktop` | Win+D | Active window title |
| `window.minimize` | Minimise the active window | Window state |
| `window.maximize` | Maximise the active window | Window state |
| `browser.back` | Alt+Left | Not observable |
| `browser.forward` | Alt+Right | Not observable |
| `browser.zoom_in` | Ctrl++ | Not observable |
| `browser.zoom_out` | Ctrl+- | Not observable |
| `screenshot.capture` | Save a PNG into the real Pictures folder | The file is checked on disk |
| `dictation.stop` | Leave dictation mode | State |
| `control.emergency_stop` | Stop everything and latch | State |

### Tier 2 — on-screen approval every time (10 s timeout cancels)

| Action id | What it does |
| --- | --- |
| `app.launch` | Launch an app whose exact path exists in the user's app allowlist |
| `url.open` | Open an allowlisted website, or a typed `http`/`https` address |
| `shortcut.copy` | Ctrl+C |
| `shortcut.paste` | Ctrl+V |
| `shortcut.undo` | Ctrl+Z |
| `shortcut.redo` | Ctrl+Y |
| `shortcut.save` | Ctrl+S |
| `shortcut.select_all` | Ctrl+A |
| `shortcut.new_tab` | Ctrl+T |
| `shortcut.close_tab` | Ctrl+W |
| `dictation.start` | Enter dictation mode |
| `dictation.type` | Type one dictated utterance (only while dictation mode is active) |

Approval can come from the dialog buttons, a deliberate thumbs-up held for
1.5 s, or the voice word “approve”. A single pinch can never approve anything.
The approval expires after 10 seconds; an expired approval executes nothing.

### Tier 3 — blocked, no override

| Action id | Blocked intent |
| --- | --- |
| `shell.run` | Shell, PowerShell, cmd, terminal |
| `script.run` | Scripts and non-allowlisted executables |
| `file.delete` | Delete a file or folder |
| `file.move` | Move a file or folder |
| `file.rename` | Rename a file or folder |
| `recycle.empty` | Empty the recycle bin |
| `system.settings` | Change system settings or the registry |
| `app.install` | Install software |
| `app.uninstall` | Uninstall software |
| `password.read` | Read or type passwords and secrets |
| `account.change` | Change account details |
| `message.send` | Send a chat message |
| `email.send` | Send an email |
| `finance.pay` | Pay or transfer money |
| `security.disable` | Disable security software |
| `power.shutdown` | Shut down |
| `power.restart` | Restart |
| `power.logoff` | Log off |
| `keyboard.any` | Any key combination not on the shortcut allowlist |
| `typing.free_text` | Type free text outside dictation mode |

Tier 3 returns exactly **“This action is blocked for safety.”** There is no
confirm button and no configuration flag that changes the tier.

## Turning it on

1. Start the backend (see the README commands).
2. Open Settings → Module permissions and grant **HGI · device control**.
3. Open the Desktop Control panel (menu → Desktop Control, the Dock button, or
   Settings) and press **Turn on**.
4. Start gestures and choose **Desktop** mode in the HUD. The red banner appears
   as soon as control is on, even before the first action.

Turning control off, closing the socket, hiding the tab for 10 seconds, or
revoking the permission all stop OS output. Turning gestures off stops
gesture input but leaves control armed until you turn it off.

## Hands-free input

### Voice

Push-to-talk is a configurable key (Space by default outside text fields) and
can be disabled in Settings → Hands-free voice. The optional wake word “BOZZ”
makes listening continue between commands; every utterance still has to start
with “BOZZ” (or the saved wake word) while that mode is on.

The command grammar is deterministic. Only these families map to actions, in
English and the Tanglish variants the parser knows:

| Say | Action |
| --- | --- |
| “scroll down” / “scroll up” | `mouse.scroll` |
| “volume up / down”, “mute”, “unmute” | `volume.*` |
| “pause the video”, “resume music” | `media.play_pause` |
| “next track”, “previous song” | `media.next` / `previous` |
| “brightness up / down” | `brightness.*` |
| “switch window”, “show desktop”, “minimise”, “maximise” | `window.*` |
| “go back”, “go forward”, “zoom in”, “zoom out” | `browser.*` |
| “take a screenshot” | `screenshot.capture` |
| “copy”, “paste”, “undo”, “redo”, “save”, “select all”, “new tab”, “close tab” | `shortcut.*` (Tier 2) |
| “open Notepad” (a name in your app allowlist) | `app.launch` (Tier 2) |
| “open YouTube” / “open example.com” | `url.open` (Tier 2) |
| “start dictation”, “stop dictation” | `dictation.start` / `stop` |
| “approve”, “deny” | Resolves the newest pending approval |
| “stop”, “pause” alone | Asks a short clarifying question |
| “BOZZ stop”, “emergency stop”, “stop everything” | Emergency stop |

Anything else is left for the chat model; it is never passed to the operating
system as text or a command. Dangerous phrases are matched first and refused
even if the sentence also contains a safe word.

### Gestures (existing HGI events)

| Gesture | Desktop effect | Tier |
| --- | --- | --- |
| Point | Move the pointer inside the control area | 1 |
| Pinch | Click, after the configured click delay | 1 |
| Pinch and hold | Drag | 1 |
| Two fingers up / down | Scroll | 1 |
| Flick left / right | Switch window, with a 1 s cooldown | 1 |
| Two-hand spread / close | Browser zoom in / out | 1 |
| Open palm held 1 s | Pause / resume gesture output | — |
| Fist held 1 s | Push-to-talk | — |
| Thumbs-up held 1.5 s | Approve the pending Tier 2 action | — |

Gestures can only produce Tier 1 actions directly. Tier 2 always needs a
separate approval.

### Dictation

Dictation types into whichever window has focus, so it is deliberately hard to
start:

1. Say “start dictation” or press **Start dictation** in the panel.
2. Approve the Tier 2 request.
3. A yellow **DICTATION MODE** banner appears with a live preview, the
   remaining character budget and the warning not to dictate passwords.
4. Speak. Each utterance is typed once; the mode stops after 30 seconds of
   silence, at the character limit, when you say “stop dictation”, press the
   Stop button, or trigger any stop.

Outside this mode every typing action is rejected, including `typing.free_text`
and `dictation.type`.

## Control area and feel

The camera image is not the screen. BOZZ maps the normalised hand point into a
centred rectangle on the real screen, leaving the screen corners untouched so
the pyautogui fail-safe stays reachable.

| Setting | Default | Effect |
| --- | --- | --- |
| Active area | 80% | Size of the mapped rectangle |
| Horizontal / vertical position | 0 / 0 | Moves the rectangle by up to half a screen |
| Edge margin | 12 px | Keeps the pointer away from each edge |
| Sensitivity | 1.0× | Hand movement to pointer distance |
| Smoothing | 0.6 | One Euro style smoothing strength |
| Click delay | 120 ms | Hold time before a pinch becomes a click |
| Idle auto-off | 120 s | Disables control without input |

All values are clamped in the backend, so a bad stored config cannot push the
pointer off-screen.

## Editing the allowlists

### In the app (recommended)

Open the Desktop Control panel → **Allowlists**.

- **Apps** — add a display name and the full `.exe` path. The backend checks
  that the path exists, is a real executable, and is not a script. Removing an
  entry takes effect immediately.
- **Websites** — add a label and an `http`/`https` URL. Other schemes,
  credentials in the URL and spaces are refused.
- **Shortcuts** — enable or disable each of the eight allowlisted key
  combinations. A disabled shortcut cannot be run even by voice.

The lists are stored in `data/desktop-allowlist.json`, which is written by the
backend only.

### In the shipped config

`config/desktop_actions.json` is the source of truth for action ids, tiers,
parameter bounds, the approval timeout, the rate limit and dictation limits. You
can edit it while the backend is stopped, then restart. Adding a new action id
requires backend code to execute it — the config only defines the contract.

Seed entries: Notepad (`C:\Windows\System32\notepad.exe`), YouTube and Google.

## API surface

All routes require the `device_control` grant where they can change state.

| Route | Purpose |
| --- | --- |
| `GET /desktop/status` | Real state, capabilities, recent actions, pending approvals, dictation state |
| `POST /desktop/enable` | Turn control on or off |
| `POST /desktop/stop` | Emergency stop (latched) |
| `GET /desktop/allowlist` | Read-only action list plus editable apps, URLs and shortcuts |
| `POST /desktop/allowlist/apps` / `.../apps/remove` | Add or remove an app |
| `POST /desktop/allowlist/urls` / `.../urls/remove` | Add or remove a website |
| `POST /desktop/allowlist/shortcuts` | Replace the enabled shortcut set |
| `POST /desktop/command` | Run a voice/text phrase through the deterministic parser |
| `POST /desktop/action` | Request one action id with typed parameters |
| `GET /desktop/approvals` | List pending Tier 2 approvals |
| `POST /desktop/approvals/{id}` | Approve or deny one approval |
| `POST /desktop/dictation` / `/desktop/dictation/stop` | Start or stop dictation |
| `POST /desktop/config` | Update the control rectangle and timing values |
| `POST /desktop/presence` | Report tab visibility and focus |
| `GET /desktop/audit` | Recent audit entries (no dictated text) |
| `WS /ws/desktop?token=…` | Gesture stream and state push |

## Testing checklist

Start with the backend stopped and the pointer in an empty spot, away from the
top-left corner.

1. **Emergency stop first.** Start the backend and frontend, grant the
   permission, turn control on in the panel, and press **Emergency Stop**. The
   red banner must switch to *stopped*, the pointer must be released, and a
   second attempt to run any action must be refused with *emergency stopped*.
2. **Restart** the backend (the latch clears only on restart) and turn control
   on again.
3. **Notepad.** Create `C:\Users\<you>\Documents\bozz-test`, open Notepad, and
   follow the in-panel checklist: point over empty space, pinch to click,
   pinch-hold to drag, two fingers to scroll, flick to switch windows.
4. **Tier 2.** Add a test URL in the allowlist, say “open …”, and confirm the
   dialog shows the exact target, a countdown, and that **Deny** executes
   nothing. Then approve once.
5. **Tier 3.** Say “delete all files”, “open PowerShell” and “send a message” —
   each must answer *This action is blocked for safety* with no OS effect.
6. **Dictation.** Press Start dictation, approve, type into the test folder's
   `notes.txt`, then say “stop dictation”. Attempting to type without the
   banner must fail.
7. **Auto-disable.** Turn control on, switch to another tab for 10 seconds,
   come back to Settings — the state must read Off with the reason.
8. **Audit.** Open `data/desktop-actions.log` and confirm the actions above
   appear with timestamps and no dictated text.

## Known limits

- **Elevated windows.** Actions sent by a non-elevated process cannot click or
  type inside windows running as Administrator. Run BOZZ elevated only if you
  understand the risk.
- **Secure desktop.** UAC prompts, the lock screen and Ctrl+Alt+Del are not
  reachable by pyautogui or pynput. This is intentional.
- **Games and full-screen 3D.** Many use raw input or exclusive capture; only
  some receive synthetic mouse events.
- **Browser internals.** Browser actions are ordinary key combinations. A
  terminal, editor or game with focus receives them instead of the browser.
- **Unverifiable actions.** Media keys, scrolling, browser back/forward and zoom
  cannot be confirmed. They are reported as *executed, not verified*, never as
  done.
- **Brightness.** Needs a display that exposes brightness through
  `screen-brightness-control`. External monitors often do not.
- **Volume.** Needs pycaw/comtypes and a default audio endpoint. If the panel
  shows volume as unavailable, the action is refused instead of pretending.
- **App launching.** Only existing executables with an exact allowlisted path.
  Scripts, `.bat`, `.msi` and arguments are refused; there is no shell.
- **Approval timeout.** 10 seconds by design. An approval that arrives after
  expiry does nothing, and a re-request creates a new approval.
- **Wake word.** “BOZZ” is a local Web Speech prefix check, not an always-on
  keyword spotter. Without wake mode you must hold push-to-talk.
- **Dictation.** Uses the browser's Web Speech recognition, so accuracy depends
  on that engine and the network behaviour it chooses. It stops on 30 s of
  silence and never types outside its banner.
- **Talon/Edge cases.** Games, remote-desktop sessions and some accessibility
  tools intercept synthetic input; none of that is detected.
- **Session token.** Stops other local pages from connecting, but it is not a
  multi-user security boundary. Keep the backend bound to `127.0.0.1`.
- **Emergency latch.** Cleared only by restarting the backend. There is no
  “resume” button by design.

## Dependencies

Backend (`backend/requirements.txt`): `pyautogui`, `pynput`, `pillow`, `pycaw`,
`comtypes`, `screen-brightness-control`. If pyautogui or pynput is missing the
status endpoint reports it and desktop control stays unavailable instead of
faking actions.

## Tests

```powershell
# backend
$env:PYTHONPATH="backend"; .\.venv\Scripts\python.exe -m unittest discover -s tests/backend -t tests/backend -q

# frontend
cd frontend
npm test
```

`tests/backend/test_desktop_v2.py` covers: every Tier 3 id blocked before any OS
call, unknown ids refused, non-allowlisted apps and non-http URLs refused,
parameter schema bounds, the rate limiter, coordinate mapping with position
offsets and edge clamping, all auto-disable conditions, the emergency latch,
dictation guards (including “never types outside the mode” and “dictated text
never enters the audit log”), the voice grammar, and Intent Map stages for a
Tier 2 voice request.
