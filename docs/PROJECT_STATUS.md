# BOZZ Project Status

Last audited: 2026-11-09
Audit scope: complete repository, runtime behavior, tests, and documentation.
Evidence baseline: from the repository root, `PYTHONPATH=backend ./.venv/Scripts/python.exe -m unittest discover -s tests/backend -t tests/backend` → **108 tests, OK (1 skipped)**; `npm test` → **26 tests, OK**; `npm run lint` and `npm run build` → **pass**. Live HTTP and in-app browser checks were also performed (see "Verification performed").

## Status legend

- **Implemented and tested** — exists, has automated coverage or was exercised live in this audit.
- **Implemented but not fully tested** — exists and builds, but depends on hardware, packaging, or manual checks not performed here.
- **Partially implemented** — a real slice works; important parts of the intended capability are missing.
- **Planned** — designed but not built.
- **Blocked** — cannot be built safely/meaningfully until a prerequisite exists.

## Implemented and tested

| Area | What exists | Evidence |
| --- | --- | --- |
| Frontend build quality | React 19 + TypeScript + Vite app, ESLint 10 | `npm run lint`, `npm run build` pass (index 519 kB, lazy Messages/Spatial/ModelViewer chunks, lazy Three.js chunk 605 kB; chunk-size warning only) |
| Command center shell | JARVIS-style HUD (grid, vignette, corner brackets, radar rings, scanning arc), centred orb home, top bar (History, menu, brand, status dot, Settings), History/menu/settings slide-overs, nine-item HUD dock, `/system` hub, cyan/gold themes | Live browser verification at 512×483 and DOM layout measurements |
| Three.js orb | `orbScene.ts` adapted from ultron-by-sagar-builds-main (MIT): layered wireframe shells, crossing arcs, liquid core, debris and dust; real idle/listening/thinking/speaking/error/offline states; speaking glow uses the live analyser; drag spin and wheel zoom; Low/Medium/High quality; pixel ratio capped at 1.5; pauses when hidden; disposes on unmount | Build and live browser checks for idle, theme switch, quality switch, and canvas disposal/recreation |
| History and shortcuts | History loads real conversation and workflow entries only when opened, with loading/empty/offline/error states; 200 ms left slide-over; `H`, `/`, `Esc`, `?` shortcuts; typed or spoken “show history”; toasts for voice fallback, backend outages, and errors | Live browser checks for open/close via button and `H`, `Esc`, `/` focus, and the shortcuts overlay |
| Backend health | `GET /health` reports database and workspace readiness; lifespan initializes schema | Automated API contract test + live call |
| Provider registry | Explicit `AIProvider` protocol, registry with default selection, status reporting | 3 unit tests |
| Ollama adapter | Stdlib HTTP adapter, exact model membership check, timeout, structured failure | Unit test + live `GET /ai/status` and `POST /chat` with `qwen2.5:1.5b` |
| ElevenLabs speech | Server-side `/tts` and `/tts/status`; 500-char chunking, 4,000-char total cap, MP3 response, 503/502/429 JSON errors; key loaded from `backend/.env` and never exposed | 13 unit tests + live call (23 KB MP3) |
| Voice visualizer | 28 DOM bars directly below the orb, driven only by `AnalyserNode.getByteFrequencyData`; flat and dim when silent; Three.js orb core glow follows the same real loudness; Stop button and Escape reset playback | Live browser capture: 34 animated frames, level up to 0.657; Stop and Escape verified |
| SQLite persistence | WAL database; `intents`, `intent_steps`, `audit_log`, `schema_meta`; per-operation connections with guaranteed close | Used by 11 workflow tests; live database inspected |
| Sandboxed workspace tools | list, read, search, stats, mkdir, write, append, move, delete for `data/workspace` only | 11 path-safety and behavior tests |
| Overwrite protection | Refuses silent overwrite; explicit overwrite backs up prior content to `.trash/overwrites` | Automated test |
| Delete safety | Moves to `.trash/<UTC stamp>/` instead of erasing | Automated test |
| Verification | Re-reads disk and checks hashes/existence after each action | Automated tests + live run (33 bytes verified) |
| Permission policy | Risk tiers, reversibility, explicit approval required for every action | Exercised by every workflow test |
| Approval binding | Per-plan `secrets.token_urlsafe(24)` challenge compared with `hmac.compare_digest`; `confirm: true` required | Tests for wrong token and missing confirmation |
| Intent workflow engine | Six steps, persisted events, status machine, structured failures, reports | 11 workflow tests + live API/browser run |
| Intent Map console | Live propose → approve → execute → verify → report UI with history, audit, workspace stats | Live DOM-driven browser verification |
| Audit trail | Append-only `audit_log` for propose/approve/reject/execute/verify/report | Test asserts 5 entries for a completed run |
| Path-safety rejection | `..`, absolute, drive, UNC, `~`, control chars, ADS, reserved names, symlink escapes, `.trash` access | Automated tests; a real traversal bug was found and fixed during testing |
| Run limits | 256 KiB read/write, 20 search results, 60 s model timeout, 4,000-char intent, 12,000-char chat | Automated tests + schema validation |
| HGI core | One MediaPipe camera pipeline, One Euro filter + prediction, 12-feature normalisation, pinch hysteresis, per-hand state machine, centroid/k-NN classifier, typed event bus, replay source | Vitest: One Euro, pinch machine, mapping, classifier (20 tests) |
| HGI storage | Calibration in `localStorage`; taught gestures and landmark-only sessions in IndexedDB; gesture-test results in `localStorage` | Code-reviewed; export/import JSON path |
| Gesture Lab UI | `/gesture` page with live camera preview + landmark overlay, diagnostics, calibration, teach-a-gesture, 20-trial test, session recorder/replay, settings, desktop panel | `npm run lint`/`npm run build` pass; live checks pending on camera hardware |
| Desktop control v2 | `/desktop/*` + `/ws/desktop`, OFF by default with its own permission; three tiers in `config/desktop_actions.json`; Tier 1 mouse/volume/media/window/browser/screenshot; Tier 2 approval every 10 s for apps, URLs, shortcuts and dictation; Tier 3 blocked; voice/Tanglish grammar, wake mode, push-to-talk, dictation banner; auto-off on hidden tab, lost tracking, idle, camera or socket loss; emergency latch, `Ctrl+Alt+Q`, corner fail-safe, “BOZZ stop”, local audit log | `test_desktop_v2.py` + full backend/frontend suites; manual Notepad/hardware test pending |
| Mini orb (Electron) | Second frameless/transparent always-on-top 240×250 window rendering the orb at a 12–30 fps mini preset; click-through outside the orb circle; wander/dock/size/opacity/monitor/pause settings; approval popup, mic/camera/desktop flags, emergency stop; Ctrl+Alt+M, “BOZZ minimize/maximize” and a top-bar button; browser build hides the control and shows “Mini mode needs the desktop app.” | 43 Vitest cases (wander geometry, mode state, IPC sanitizers, pause policy); Electron smoke runs verified mode switching, OS-level window visibility, click-through toggle (`WS_EX_TRANSPARENT`), settings UI, phrase routing, idle pause and CPU (~2.8–4.1% total on the i3 test laptop). Real mouse drag, PTT keys, approval popup, right-click menu and voice recognition inside the mini window still need a manual pass |
| Module registry and permissions | `/modules` page and backend registry with version, real status, capabilities and required permissions; permissions off by default, grantable in Settings, stored locally and audited; server-side enforcement on consequential routes | `test_module_permissions.py` + live `/modules` and permission grant/revoke checks |
| L3DME viewer | Lazy `/3d` Three.js viewer for local GLB/glTF, orbit/zoom/pan, solid/wireframe/transparent, mesh part selection, exploded view, typed control API, DPR cap, visibility pause and disposal | Production build + live canvas/part checks; 6 Vitest explode tests |
| Spatial Desktop | Read-only `/spatial` workspace over explicitly allowed folders; list/search/preview/thumbnail; OS-open only for allowed non-executable files through Intent Map approval; drag/resize/group/dismiss/undo, layouts, voice commands | `test_spatial_files.py` + live browser checks |
| Holographic Projects | Read-only `/projects` 3D folder tree over allowed folders (lazy children, 60/300 caps, radial layout, previews, approved OS open) plus a `.glb`/`.gltf` hologram viewer with real part names, exact explode/reassemble, typed control API and gesture-bus input; named views saved as layout JSON; no write/move/rename/delete endpoint | `test_holo_files.py` (10), frontend Vitest layout/taps/explode/modelSource/commands/readonly (33), `npm run lint`, `npm run build` |
| BCI Messages | Local `/messages` workspace with conversation CRUD, retention cleanup, text/JSON/WhatsApp import, summaries, local-rule unanswered/attention, drafts, rewrite/translate, style profile, remote-provider confirmation; no send path | 18 BCI backend tests incl. “no send path exists”, retention and import parsers; full browser run |

## Implemented but not fully tested

| Area | What exists | What is missing |
| --- | --- | --- |
| Electron shell | `frontend/electron/main.cjs`; hardened `BrowserWindow`s (main + mini orb), contextBridge preload, validated IPC, mini window controls | No packaged installer, no code signing, no production file:// or updater path; only dev-mode startup is known to work |
| Browser speech | Web Speech recognition and speech synthesis, now used as the fallback when ElevenLabs is unavailable | Depends on browser/Speech service availability; no automated test; not exercised on target hardware |
| Camera hand tracking | MediaPipe landmarks with local wasm/model, calibration, confidence and filtering | Real camera accuracy, lighting, and false-trigger rates were not measured on target hardware here |
| Desktop mouse control | Real pyautogui adapter behind an explicit toggle | Manual Notepad/hotkey test and packaged-Electron path pending |
| Browser-local persistence | Projects, notes, notifications, settings, conversations | Persistence across restarts is code-reviewed, not automatically tested |

## Partially implemented

| Area | Working slice | Missing |
| --- | --- | --- |
| Local AI providers | Ollama adapter and registry | Only one provider; no model picker or streaming; no configuration UI |
| Conversation context | Newest 80 messages in `localStorage`; up to 12 turns sent to the model | No backend conversation store, export, delete, search, or long-term memory engine |
| Intent understanding | Deterministic grammar for workspace commands only | No free-form natural-language planning; unsupported text is reported, not guessed |
| Intent workflow | Full lifecycle for workspace file actions | Not connected to chat/voice/gesture inputs; gesture events never auto-approve file actions; one intent per request |
| Permission engine | Per-plan approval, risk labels, audit, persistent per-module grants enforced server-side | No scopes, expiry, or per-capability preferences beyond the module permission |
| Gesture interface | Hand landmarks, calibrated pinch, three modes, desktop control v2 adapter | Accuracy varies by hardware; on-target manual validation pending |
| Voice I/O | ElevenLabs speech with browser fallback, real analyser bars, voice input, push-to-talk and a local “BOZZ” wake-prefix gate | Wake mode is a prefix check, not an always-on keyword spotter; no dedicated Voice Studio page (`/voice-studio` is marked unavailable) |
| Command center | Real backend/provider/workspace signals; unavailable modules labeled | Some panels remain static summaries or previews |

## Planned or blocked

| Area | Status | Reason |
| --- | --- | --- |
| Backend conversation and memory database | Planned (next milestone) | BCI stores imported message threads, but general chat still has no backend history, export, delete or search |
| 3D Engineering Studio (engineering import/export) | Planned | The `/3d` viewer exists; CAD import, measurement and export assets do not |
| Vision analysis | Planned | No image-input permission flow or local vision model |
| Hardware adapters | Planned | No hardware protocol, drivers, or safety model |
| BOZZ Firm / Society / Market Analyzer | Planned | Vision-level modules; not started by design |
| Authentication / multi-user roles | Blocked | Single-user loopback app; adding accounts without transport security would be misleading |
| Packaging / auto-update | Planned | No installer pipeline; Electron is dev-only |

## Problems discovered in the audit

1. The repository had no backend tests, dependency manifest, database, permission model, or foundation docs before this milestone.
2. The original chat could produce scripted local replies that looked like model output. It now reports real provider failures.
3. A real path-traversal bug existed in command cleanup: a trailing-period rule turned `..` into `.`, so `list files in ..` was wrongly approved. Fixed and covered by a regression test.
4. Environment dashboards showed CPU/temperature data that a browser cannot legitimately obtain. Those values are shown as unavailable.
5. (Resolved in the HGI milestone) Two navigation entries used to share `/vision`. Gesture Lab now owns `/gesture`; `/vision` is an honest "not connected" placeholder that links to it.
6. There is no React error boundary; a render exception can blank the app.
7. Gesture recognition accuracy is hardware- and lighting-dependent; the UI reports measured confidence instead of a fixed accuracy claim.
8. Append is marked non-reversible because BOZZ cannot automatically undo it.
9. During live BCI verification, the model paraphrase used for “Needs attention” turned a question (“can you share the quote?”) into a claim (“the quote is available”). `unanswered` and `attention` now use deterministic local rules that quote stored text and never call the provider; only summaries and drafts use the model.

## Verification performed

- 145 backend tests (workspace, intent engine/stages, provider registry, API, AI provider, TTS, desktop v1/v2, module permissions, spatial files, holo files, BCI); 1 skipped.
- 142 Vitest tests, including `holo/layout`, `holo/taps`, `holo/explode`, `holo/modelSource`, `holo/commands` and a source check that the file API has no write/move/rename/delete/upload route.
- Live `uvicorn` calls: health, provider status, propose, wrong-token approval (403), approve, execute, report, double execution (409), blocked path escape, audit, workspace summary, desktop status/enable/stop.
- Disk checks: `data/workspace/demo/hello.txt` content and hash; rejected plans left no files; rejected approval left an existing file untouched.
- Browser checks via the in-app browser: full plan → approve → execute → verify → report flow; unsupported command examples; history/audit/stats refresh; rejection path.
- `/modules` shows the live registry (8 ready, 2 not connected) and the permission grant/revoke flow; `/3d` loads the built-in mesh and exposes real part names.
- `/spatial` renders the read-only workspace, and `/calls`, `/devices-hub`, `/vision`, `/gesture`, `/system` and `/settings` render without errors.
- BCI live run: permission gate → grant → Simulation sample → Summarise (provider result) → Unanswered/Needs attention (local-rule result, no provider call) → Draft reply → `[CONFIRM]` placeholder blocks Copy → remove placeholders saves → paste/import a WhatsApp export → per-conversation and Delete all confirmations → retention save → Settings grant/revoke and style save → typed “summarise my messages” routes through an Intent Map task with `model_response` evidence. Chat and history still worked afterwards.
- Gesture Lab, `/system`, and `/vision` render with real backend values; chat still replies through Ollama; pressing **Start gestures** without a camera produced the honest permission error and kept the camera released.
- `/projects` live run with the demo folder: permission gate → allowed root auto-opens with real entries → canvas single-tap expands a folder and lazily reads its children → double-open becomes the new root, Back and Esc return one level → `.gltf` opens in the hologram viewer with the external `.bin` sidecar, real part names/sizes and triangle counts → all four render modes → Explode 60 % then 0 % returns the parts to the original arrangement → part select shows the real mesh name/box size → Hide/Isolate/Show all change only the scene → named view saved and restored after a reload (root, expanded folders, camera) → typed “expand models”, “open my engineering folder”, “show only images”, “show all files”, “zoom in”, “go back” route through the shared provider, and the audit log records the folder search and read-only model reads. Chat, history, orb, `/spatial`, `/modules`, `/settings` still render afterwards.
- Frontend lint and production build.

## Not verified here

- Windows installer/packaging and auto-start behavior.
- Speech APIs across browsers and microphones.
- Camera gesture accuracy, lighting, and false-positive rate. The automated browser has no camera, so the only camera path exercised live was the honest `Camera permission was denied` error with the camera released.
- The Notepad desktop-control walkthrough and the `Ctrl+Alt+Q` global hotkey require a physical mouse and keyboard session. Only the backend gates (off by default, token rejection, disabled-command rejection, mapping, rate limit, emergency latch) were exercised.
- Sustained memory/CPU use on 8 GB integrated-graphics hardware with the 3D orb active.
- Accessibility audit (keyboard-only traversal, screen reader behavior).
- Hand-gesture paths in Holographic Projects (point/pinch/spread/wrist) need a camera; only the shared-bus plumbing and the mouse/touch fallbacks were exercised. Touch input was simulated, not tested on a touchscreen. Models larger than 50 MB, the `+N more` folder cap with real oversized folders, and sustained 3D load on the i3/8 GB laptop were not exercised.
- Any cloud, multi-user, or networked deployment; none is implemented.
