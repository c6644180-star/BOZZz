# BOZZ AI

BOZZ is a local-first personal AI environment: a React desktop command center, a small FastAPI backend, a replaceable local-model adapter, and a permissioned action workflow. It is built in tested milestones; planned capabilities are never presented as connected services.

Current verified state: **2026-11-09**. Backend suite: **108 tests passing (1 skipped)**. Frontend: **26 Vitest tests, lint and production build passing**.

## What works now (implemented and tested)

- **JARVIS-style command center** with React 19, TypeScript, Vite, and a real-time Three.js orb (lazy loaded) over a non-numeric HUD frame. The orb shows only real app states (idle, listening, thinking, speaking, error, offline), uses the live speech analyser for its speaking glow, and supports drag-to-spin and wheel zoom. Cyan/Gold theme and Low/Medium/High quality are saved in `localStorage`.
- **Minimal command layout** with a centred orb, real voice-state label, Stop control, live wave bars, a slim command bar with real navigation chips, and a nine-item HUD dock. History, menu, and settings slide over the orb instead of occupying a sidebar.
- **Keyboard and history access**: `H` opens History, `/` focuses the command bar, `Esc` closes panels and stops speech, and `?` shows a shortcuts overlay. Typing or saying “show history” opens the real history panel, which loads conversation and workflow entries only when opened.
- **Honest status everywhere**: a status dot reports backend and voice state on hover, optional CPU/RAM widgets say “Not connected” until the backend exposes metrics, and toasts report voice fallback and backend outages without invented numbers.
- Navigation, projects, notes, notifications, preferences, and bounded chat history are stored in the browser.
- **Local AI chat** through a replaceable provider registry. The default adapter talks to a local Ollama server with the Python standard library only. The verified local model is `qwen2.5:1.5b`; failures are shown, never simulated.
- **SQLite runtime state** at `data/bozz.sqlite3` with intent records, append-only step history, and an append-only audit log (WAL mode).
- **Permissioned workspace actions** inside `data/workspace/`. A deterministic command parser proposes structured actions; every plan requires explicit approval bound to a per-plan challenge; execution is followed by independent disk verification and a report.
- **Intent Map console** (`/intent-map`) that runs the real lifecycle: `UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT`, with plan previews, risk labels, approve/reject controls, verification results, history, audit trail, and workspace statistics.
- **Sandbox protections**: path traversal, absolute paths, UNC paths, drive prefixes, alternate data streams, symlink escapes, oversized reads/writes, and silent overwrites are rejected. Deletes move items to `.trash`; overwrites keep a backup.
- **Windows hardening in Electron**: Node integration off, context isolation on, sandbox on. The Electron shell is development-only and is not packaged yet.
- **BOZZ HGI hand gestures** (`/gesture`): one local MediaPipe camera pipeline with One Euro filtering, calibration, a confidence-gated classifier, and a typed event bus. Three modes — orb spin/zoom, an in-page cursor, and an opt-in desktop mouse. Diagnostics show real latency, fps, confidence, and false-click counts; sessions store landmark numbers only; a 20-trial test measures real hit and false-trigger rates. See [docs/hgi.md](docs/hgi.md).
- **Desktop control v2**: `/desktop/*` and `/ws/desktop`, OFF by default with its own `device_control` grant. Three tiers in `config/desktop_actions.json`: Tier 1 mouse/volume/media/window/browser/screenshot runs immediately, Tier 2 apps, URLs, shortcuts and dictation need approval every 10 s, Tier 3 shell/script/file/install/password/message/payment/security/power actions are blocked. Gesture and voice input (including “BOZZ stop”), push-to-talk, wake prefix, dictation banner, auto-off on hidden tab or lost tracking, `Ctrl+Alt+Q`, corner fail-safe and a local action log with no camera or audio data. See [docs/desktop-control.md](docs/desktop-control.md).
- **Module registry and permissions** (`/modules`): every module reports a real version, status and required permission. Permissions are off by default, grantable in Settings, stored locally and audited; the backend enforces them on consequential routes.
- **L3DME local 3D viewer** (`/3d`): lazy Three.js workspace for local GLB/glTF files with orbit/zoom/pan, solid/wireframe/transparent modes, real mesh part selection, exploded view and a typed control API. Files are read in the browser and never uploaded.
- **Spatial Desktop** (`/spatial`): a read-only workspace over folders the user explicitly allows in Settings → File access. Cards can be dragged, resized, grouped, previewed and opened with the OS default app; executables and scripts are shown but never opened. Dismissing a card never deletes the file.
- **BCI Messages** (`/messages`): local conversation storage with retention controls, plain-text/JSON/WhatsApp-export import, summaries, unanswered questions, attention markers, drafts, rewrite and translation. There is **no send path**: no send endpoint, SMTP or messaging API. Drafts stay in BOZZ labelled “Draft only, not sent”, and `[CONFIRM: ...]` placeholders block Copy until resolved. See [docs/bci-integrations.md](docs/bci-integrations.md).

## What is not implemented

Vision analysis, hardware adapters, user accounts/authentication, packaged Electron distribution, and the BOZZ Firm, Society, and Market Analyzer modules are **planned or preview-only**. Gesture accuracy has not been benchmarked on target hardware, and desktop control still needs a manual Notepad/hotkey test on your machine. The UI labels unavailable services instead of faking them. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for the exact status of every area.

## Requirements

- Windows 10/11 (tested on Windows 10, Intel i3, 8 GB RAM class hardware)
- Python 3.13 (3.13.15 verified) with `pip`
- Node.js 24 and npm
- Ollama is optional. Without it, chat reports an unavailable provider; the workspace workflow still runs.

## Run BOZZ on Windows PowerShell

From the repository root, in terminal one:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In terminal two:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite address, normally `http://localhost:5173`. The frontend calls `/api/*`, which Vite proxies to `http://localhost:8000` after removing the prefix.

For local chat, install and start Ollama, then pull the configured model:

```powershell
ollama pull qwen2.5:1.5b
ollama serve
```

## Try the first working feature

1. Start both servers and open `/intent-map`.
2. Enter `create a file named demo/hello.txt containing: hello from BOZZ`.
3. Review the plan card: action type, target, risk level, reversibility, and preview.
4. Select **Approve and execute**. BOZZ records approval, executes, re-reads the file, hashes it, and reports verification.
5. Confirm the file exists at `data/workspace/demo/hello.txt`. Inspect the audit trail and recent runs in the page.
6. Try `list files in .` (low risk) and `delete demo/hello.txt` (high risk, moved to `data/workspace/.trash/`).
7. Enter an unsupported sentence. BOZZ reports that it cannot plan it and shows supported command examples; it does not invent an action.

The workspace root is intentionally limited to `data/workspace`. BOZZ never operates on arbitrary disks, user folders, or system paths.

## Verify

```powershell
# From the repository root
$env:PYTHONPATH = 'backend'
.\.venv\Scripts\python.exe -m unittest discover -s tests\backend -v

# From frontend
npm test
npm run lint
npm run build
```

Backend tests cover path-safety rejection, no-silent-overwrite, backup and trash behavior, size limits, the approval challenge, execute-before-approve rejection, failure handling, audit completeness, the provider registry, speech routes, the desktop adapter (default-off, mapping, gates, drag release, emergency latch, audit log), the module permission registry, Spatial Desktop path rules and OS-open blocking, BCI import parsers, retention cleanup, the remote-provider confirmation and the “no send path exists” invariant. Frontend tests cover One Euro filtering, pinch hysteresis, coordinate mapping, the classifier, and L3DME exploded-view maths.

## Local data and reset

| Path | Purpose | Tracked by git |
| --- | --- | --- |
| `data/workspace/` | Only folder BOZZ may act on | No |
| `data/workspace/.trash/` | Deleted items and overwrite backups | No |
| `data/bozz.sqlite3` | Intents, step events, audit log, spatial layouts, BCI conversations/messages/drafts | No |
| Browser `localStorage` | Projects, notes, notifications, settings, chat history | No |

Stopping the servers and deleting `data/` resets all backend runtime state. This removes workspace files too; export anything you want to keep first. Browser-local data is cleared through the browser profile.

## Configuration

Environment variables (see [backend/.env.example](backend/.env.example)); the core features need no API keys. ElevenLabs voice is optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOZZ_OLLAMA_URL` | `http://127.0.0.1:11434` | Local model endpoint; loopback by default |
| `BOZZ_OLLAMA_MODEL` | `qwen2.5:1.5b` | Exact installed model name |
| `BOZZ_MODEL_TIMEOUT_SECONDS` | `60` | Local model request timeout |
| `BOZZ_DATA_DIR` | `<repo>/data` | SQLite and workspace parent |
| `BOZZ_MAX_READ_BYTES` | `262144` | Read limit |
| `BOZZ_MAX_WRITE_BYTES` | `262144` | Write/append limit |
| `BOZZ_MAX_SEARCH_RESULTS` | `20` | Search result cap |
| `BOZZ_LOG_LEVEL` | `INFO` | Backend log level |
| `ELEVENLABS_API_KEY` | empty | Optional; server-side only, never sent to the browser |
| `ELEVENLABS_VOICE_ID` | empty | Optional; voice used for `/tts` |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | Optional TTS model |
| `BOZZ_DESKTOP_MIN_CONFIDENCE` | `0.7` | Desktop mouse confidence floor |
| `BOZZ_DESKTOP_RATE_LIMIT` | `60` | Desktop commands accepted per second |
| `BOZZ_DESKTOP_AREA` | `0.8` | Centred control-rectangle fraction of the screen |
| `BOZZ_DESKTOP_EDGE_MARGIN` | `12` | Pixels inset inside the control rectangle |
| `BOZZ_DESKTOP_HOTKEY` | `<ctrl>+<alt>+q` | Global emergency-stop hotkey (pynput syntax) |

## Try hand gestures

1. Start both servers and open **Gesture Lab** (`/gesture`).
2. Select **Start gestures** and allow the camera. The HUD shows CAMERA ACTIVE with real fps, hands, and latency.
3. Run **Calibration** (open palm, pinch, fist, relaxed), then try **Cursor** mode: point to move, pinch to click, pinch-hold to drag, two fingers to scroll, open palm for 1 s to pause.
4. Desktop control stays off until you turn it on in the Desktop panel. Test it with Notepad first; the Emergency Stop button, `Ctrl+Alt+Q`, or moving the pointer to the top-left corner stops it.
5. Use **Gesture test** and **Record/Replay** to measure hit rate and compare filter settings on identical landmark data. Full details: [docs/hgi.md](docs/hgi.md).

## Documentation

- [Project status](docs/PROJECT_STATUS.md) — what is tested, partial, planned, or blocked
- [System architecture](docs/SYSTEM_ARCHITECTURE.md) — runtime, modules, data flow, trust boundaries
- [Development roadmap](docs/DEVELOPMENT_ROADMAP.md) — milestone order and acceptance criteria
- [API design](docs/API_DESIGN.md) — endpoints, schemas, enums, errors
- [Security and permissions](docs/SECURITY_AND_PERMISSIONS.md) — enforced controls and remaining risks
- [Hand Gesture Intelligence](docs/hgi.md) — architecture, event schema, calibration, desktop safety
- [Desktop Control v2](docs/desktop-control.md) — every action id and tier, safety model, allowlists, emergency stop, limits
- [Module registry](docs/modules.md) — statuses, permissions, Intent Map stages and evidence
- [BCI integrations](docs/bci-integrations.md) — no-send invariants, storage, imports, provider disclosure
- [Third-party notices](docs/THIRD_PARTY.md) — MediaPipe, pyautogui, pynput and other licenses
- [Full third-party license texts](THIRD_PARTY_LICENSES.md) — MIT notices for the adapted orb and Three.js
- [Decisions](docs/DECISIONS.md) — engineering decision records

BOZZ is intentionally small and local. No cloud service, paid API, or telemetry is required for the core features. ElevenLabs speech is optional and off by default unless a key is configured and voice output is enabled.
