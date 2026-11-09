# BOZZ Security and Permissions

Last updated: 2026-11-08
Applies to: local single-user development build. This is not a hardened multi-user or network-exposed service.

## Non-negotiable rules

1. Never expose API keys, credentials, or private files.
2. Require explicit user approval for consequential computer actions.
3. Never silently delete or modify important user files.
4. Show clear permission indicators for camera, microphone, and other sensors.
5. Raw model output, speech transcripts, and gesture events are untrusted; they may propose actions but never execute them.

These rules are implemented in code, not only documented. Planned features must satisfy them before release.

## Enforced controls (implemented and tested)

### Workspace sandbox

All filesystem actions are restricted to `data/workspace`.

- Rejected before resolution: control characters, absolute paths (`/...`), home shortcuts (`~`), Windows drive prefixes (`C:`), UNC paths (`//server`), any `..` segment, colons/alternate data streams, and Windows reserved device names.
- The resolved path must remain inside the workspace root (case-insensitive-safe on Windows). A symlink that escapes the root is rejected; symbolic links are not followed for actions.
- `.trash` is not reachable through the public tool surface; only internal verification may resolve a trash path.
- No API returns the absolute workspace path to the renderer.

Evidence: `tests/backend/test_workspace.py` (traversal, absolute, drive, UNC, ADS, `.trash`, malformed input, symlink handling). A real traversal bug (`..` cleaned to `.`) was found by these tests and fixed with a regression case.

### No silent overwrite, no silent delete

- `write` refuses to replace an existing file unless the command explicitly requests overwrite.
- Explicit overwrite copies the prior content into `.trash/overwrites/...` before replacement.
- Writes use a temporary file plus `os.replace` for atomicity.
- `delete` moves the item into `.trash/<UTC stamp>/<name>` and returns the trash location. Permanent erasure is not exposed.
- `move` refuses to overwrite an existing destination and refuses to move a folder inside itself.
- `append` is marked **not reversible** because BOZZ cannot automatically undo it; this is shown in the UI and policy.

### Size and resource limits

| Limit | Default | Effect |
| --- | --- | --- |
| Read | 262,144 bytes | Oversized reads rejected |
| Write/append | 262,144 bytes | Oversized writes rejected |
| Search results | 20 | Result cap |
| Intent text | 4,000 chars | API validation |
| Chat message | 12,000 chars | API validation |
| Chat history | 12 turns | API validation |
| TTS chunk / total | 500 / 4,000 chars | Backend chunking and validation |
| Model timeout | 60 s | Provider timeout |
| Intent list | 1–100 rows | Query validation |
| Audit list | 1–500 rows | Query validation |

### Explicit approval

- Every action requires approval, including low-risk reads.
- `POST /intents/{id}/approve` requires `confirm: true` **and** the exact per-plan challenge issued at proposal time.
- The challenge is generated with `secrets.token_urlsafe(24)` and compared with `hmac.compare_digest`.
- Approval is only valid from `awaiting_approval`; execution is only valid from `approved`.
- A rejected plan never executes.
- Each transition is appended to the audit log and step history.
- The plan preview strips file content payloads from the public response.

### Auditability

- `audit_log` is append-only in the data layer; the store exposes no update or delete method.
- Events: `propose`, `approve`, `reject`, `execute`, `verify`, `report`.
- Execution and verification are recorded per action with type, target, risk, outcome, and detail.

### Sensor privacy

- Camera and microphone are requested by the browser, with visible active indicators and immediate stop.
- Hand tracking uses MediaPipe locally; frames are never uploaded, recorded, or written to disk. The optional session recorder stores landmark numbers only.
- The microphone is used only to gate the `clap` gesture when explicitly enabled. Audio is read as a level, never stored or transmitted.
- Disabling gestures stops the tracks, releases the camera, and stops the classifier.
- Chat sends text only, to the configured loopback Ollama URL.
- When ElevenLabs voice output is enabled, the assistant's reply text (not microphone audio) is sent to ElevenLabs for speech synthesis. Leave `ELEVENLABS_API_KEY` empty to keep speech local or use the browser fallback.

### Desktop mouse adapter

- Disabled by default. Enabling requires live gestures and an explicit UI action; there is no automatic enable path.
- The WebSocket checks the client host (loopback or the in-process test client) and a random 32-byte token generated at startup, compared with `secrets.compare_digest`.
- Only mouse move, click, double-click, drag, and scroll exist. There is no keyboard, shell, file, or application command; unknown command types are rejected.
- Commands below the confidence floor (default 0.7) or above the rate limit (default 60/s) are dropped. `drag_end` is exempt so a drag cannot stay held.
- The frontend auto-disables when the tab is hidden for 10 s, tracking is lost for 2 s, the camera stops, or the socket disconnects.
- Emergency stop (UI button, `Ctrl+Alt+Q`, pyautogui top-left corner fail-safe) releases the drag, stops hotkeys, and latches until the backend restarts.
- `data/desktop-actions.log` records desktop actions only. No camera frames, landmarks, or audio are written. The token is never written to a log.

### Local-only boundaries

- Backend binds to `127.0.0.1` in the documented run command.
- CORS allows only `http://localhost:5173` and `http://127.0.0.1:5173`, GET/POST, `Content-Type`.
- Ollama defaults to `http://127.0.0.1:11434`.
- No API keys exist in source. `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are optional and live only in the gitignored `backend/.env`; `backend/.env.example` holds empty placeholders. Existing process environment variables take precedence over the file.
- Electron disables Node integration, enables context isolation, and enables sandboxing.
- The renderer has no native IPC bridge, file-system access, or desktop executor.

### ElevenLabs key handling

- The key is read on the backend from `backend/.env` (or the process environment) and used only in the `xi-api-key` request header.
- `GET /tts/status` returns only booleans, the model name, and limits. No key or voice ID is returned.
- `Settings` marks the key `repr=False`; logs record byte counts only, never text or headers.
- Upstream error bodies are not echoed; the client receives a short, fixed message.
- Audio responses use `Cache-Control: no-store`; the browser plays a blob URL and revokes it when playback stops.

### Failure behavior

- Tool failures stop the run; remaining actions are skipped and reported.
- Unexpected errors return a generic 500 message while details are logged locally.
- Provider failures return 503; no fallback or fabricated answer is produced.
- Unsupported commands report that they cannot be planned.

## Permission model

| Capability | Current control | Status |
| --- | --- | --- |
| Read/list/search workspace | Plan preview + explicit approval + audit | Implemented |
| Create file/folder | Plan preview + explicit approval + verification | Implemented |
| Overwrite | Explicit overwrite request + backup + approval | Implemented |
| Append | Approval; marked non-reversible | Implemented |
| Move/rename | Approval; no overwrite; verification | Implemented |
| Delete | High-risk approval; move to trash; recoverable path | Implemented |
| Camera (hand tracking) | Browser permission + on-screen CAMERA ACTIVE label + one-click Off + full release | Implemented; manual accuracy check pending |
| Microphone (optional clap gate) | Opt-in toggle + browser permission + visible status; audio never stored | Implemented; manual check pending |
| Voice output | Opt-in setting; ElevenLabs via backend key, browser fallback on failure | Implemented |
| Voice service key | `backend/.env` only; never sent to the browser or logged | Implemented |
| Model text | Treated as untrusted; cannot execute | Implemented |
| Desktop control (OS) | OFF by default with its own `device_control` grant; loopback + token, confidence and rate gates; three-tier allowlist enforced by the backend; Tier 2 approval every time; Tier 3 blocked; emergency latch; auto-off rules | Implemented and unit-tested; manual target-hardware test pending |
| External communication/publishing | Not implemented | Planned |
| Accounts/roles | Not implemented; loopback single-user only | Blocked |

## Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Path traversal | Segment rejection, root containment, regression test | New path syntaxes could need new tests |
| Symlink escape | Reject final symlink and out-of-root resolution | TOCTOU between check and action remains theoretically possible locally |
| Silent data loss | No overwrite by default; backup; trash; verification | `.trash` is not automatically purged or user-browsable in UI |
| Approval bypass | Challenge token, confirm flag, state machine, audit | A compromised local browser session could click approve |
| Gesture misfire | Confidence floor, pinch hysteresis, 60 ms hold, guarded destructive controls, hold-to-pause | Recognition accuracy depends on user calibration |
| Rogue local desktop client | Random startup token, loopback host check, enabled-off default, rate limit | No per-user authentication; loopback process access is the trust boundary |
| Desktop adapter abuse | Mouse-only command set; emergency latch; fail-safe; audit log | The adapter can move/click anywhere once enabled |
| Replay approval | Challenge tied to one intent; status transition enforced | No expiry timestamp on the challenge yet |
| Prompt injection via model | Model cannot emit executable actions; typed parser only | A future NL planner must preserve schema validation |
| Sensor capture | Visible indicators, opt-in, stop control, no upload | Browser/OS-level capture outside BOZZ is out of scope |
| Cloud voice disclosure | Voice output is opt-in; only assistant reply text is sent when ElevenLabs is configured | The reply text leaves the device to ElevenLabs; no microphone audio is sent |
| Local data exposure | Loopback only, no cloud | SQLite and `localStorage` are plaintext on disk |
| Unauthorized local API caller | Loopback binding | No authentication; another local process could call the API |
| Oversized input/resource abuse | Size caps, timeouts, row caps | No rate limiting |
| Bad model output presented as fact | System prompt requires honesty; UI shows provider failures | Model correctness cannot be guaranteed |

## Not yet protected

- No authentication or authorization. Do not bind the backend to a LAN interface or expose it through a tunnel.
- Assistant reply text is sent to ElevenLabs when voice output is enabled and the key is configured. Disable voice output or unset the key to avoid this.
- SQLite is not encrypted; `localStorage` is not encrypted. Do not store passwords, financial data, or private documents.
- No approval expiry, persistent capability grants, or per-capability user preferences.
- Desktop control is opt-in, requires the `device_control` grant, and is bounded by `config/desktop_actions.json`. Tier 1 runs immediately; Tier 2 needs a fresh 10 s approval; shell, scripts, file deletion/moves, installs, passwords, messages, payments, security changes, shutdown and unlisted keys are blocked with no override. App launching is limited to exact allowlisted executable paths with `shell=False`. The adapter is not authenticated as a multi-user service beyond the session token and loopback binding, so do not expose the backend.
- Gesture recognition has not been benchmarked on a fixed rig; treat it as assistive input, not a security control.
- No third-party npm supply-chain audit beyond normal dependency use. The home screen orb is first-party SVG; the older Three.js scene is no longer bundled.
- No packaged Electron build, code signing, or update verification.

## Operator guidance

- Keep the backend on loopback and the default CORS origins.
- Do not place private files in `data/workspace` unless you accept that BOZZ (under your approval) can read, move, or trash them.
- Review plan previews, especially high-risk deletes.
- Treat `data/` as sensitive local runtime state and exclude it from commits (already gitignored).
- If you need to reset, stop the servers and delete `data/`; this intentionally deletes workspace files and audit history.

## Verification checklist

- [x] Path-safety tests, including traversal regression.
- [x] Overwrite refusal and backup test.
- [x] Trash deletion and recovery-path test.
- [x] Wrong approval challenge → 403.
- [x] Execute before approve → 409.
- [x] Rejection executes nothing.
- [x] Audit completeness after a run.
- [x] Provider-unavailable path returns 503.
- [x] `/tts/status` exposes no key material.
- [x] Missing key returns 503; wrong key 502; quota 429 (unit tests; live 200 audio response).
- [x] Desktop control is off by default and rejects commands while disabled.
- [x] Desktop mapping, confidence floor, rate limit, drag release, emergency latch, and token comparison (unit tests).
- [x] Desktop audit log excludes camera/landmark data.
- [ ] Manual ElevenLabs playback and analyser check on target hardware.
- [ ] Manual microphone/camera permission checklist on target hardware.
- [ ] Manual desktop-control test with Notepad and the emergency hotkey on target hardware.
- [ ] Packaged-app security review.
- [ ] Authentication design review (required before any non-loopback deployment).
