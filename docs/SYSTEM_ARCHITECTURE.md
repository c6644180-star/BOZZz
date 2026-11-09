# BOZZ System Architecture

Last updated: 2026-11-08
Scope: the code that exists today. Planned layers are marked as such and do not run.

## Runtime view

```text
Browser / Electron renderer (React 19 + TypeScript + Vite)
  |  /api/* (Vite dev proxy strips /api)
  v
FastAPI backend (Python 3.13, loopback 127.0.0.1:8000)
  |-- provider registry -> Ollama adapter -> local Ollama (127.0.0.1:11434)
  |-- permission policy
  |-- intent engine (six-step lifecycle)
  |-- workspace tools (sandboxed to data/workspace)
  |-- SQLite (data/bozz.sqlite3, WAL)
  v
Local disk: data/workspace, data/workspace/.trash, data/bozz.sqlite3
```

The Vite proxy is [`frontend/vite.config.ts`](../frontend/vite.config.ts): `/api` → `http://localhost:8000`, prefix removed. CORS on the backend allows only `http://localhost:5173` and `http://127.0.0.1:5173` for GET/POST with `Content-Type`.

## Frontend

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Shell, router, top bar, slide-over panels (History, menu, settings), providers |
| `src/components/orb/Orb.tsx` | State-driven SVG arc-reactor orb with real-state animation |
| `src/components/orb/VoiceWave.tsx` | 28 bars rendered from live analyser frequency data |
| `src/components/chat/CommandBar.tsx` | Slim bottom command bar: send, mic/stop, UI shortcuts |
| `src/components/history/HistoryPanel.tsx` | History slide-over merging local chats with backend intent statuses |
| `src/components/layout/SlideOver.tsx` | Accessible slide-over dialog (focus trap, Escape, scroll lock) |
| `src/components/BozzVoiceProvider.tsx` | Chat state, speech playback, browser fallback, stop/Escape, backend calls |
| `src/pages/IntentMapPage.tsx` | Live intent workflow console (propose, review, approve/reject, execute, report, audit, workspace stats) |
| `src/pages/SystemPage.tsx` | System status, quick actions, mission, and capability panels moved off home |
| `src/services/intent.ts` | Typed API client for intents, audit, and workspace |
| `src/services/backend.ts` | Health and chat API boundary |
| `src/services/tts.ts` | `/tts/status` and `/tts` client; never handles the API key |
| `src/services/voiceAudio.ts` | AudioContext, AnalyserNode, playback, visible-only animation loop |
| `src/services/history.ts` | History model: backend intent status mapping and merge ordering |
| `src/services/localStore.ts` | Browser `localStorage` for projects, notes, notifications, settings, chat history, history |
| `src/services/speech.ts` | Web Speech API capability wrapper |
| `src/services/motionGesture.ts` | Canvas pixel-motion gesture signal, camera-gated |
| `src/config/nav.ts` | Navigation registry; `available: false` marks preview modules |
| `electron/main.cjs` | Hardened development shell only |

Build behavior: the home screen uses a pure SVG orb, so the production bundle carries no Three.js engine. Current production sizes are recorded in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Backend

| Module | Responsibility |
| --- | --- |
| `app/main.py` | App creation, lifespan initialization, CORS, routers, global exception handler, `/` and `/health` |
| `app/core/config.py` | Frozen `Settings` from environment; loads `backend/.env` without overriding real env vars; ElevenLabs key excluded from repr |
| `app/core/logging.py` | Idempotent `bozz` logger to stderr |
| `app/ai/base.py` | `AIProvider` protocol, `ProviderStatus`, `LocalProviderError` |
| `app/ai/ollama.py` | Stdlib HTTP adapter; requires the configured model to be installed |
| `app/ai/elevenlabs.py` | Stdlib ElevenLabs TTS client, chunking, typed failures |
| `app/ai/registry.py` | Provider registry; Ollama is the default; cached accessor |
| `app/api/chat.py` | `/ai/status`, `/chat` with Pydantic validation |
| `app/api/tts.py` | `/tts/status` and `/tts`; maps failures to 400/429/502/503 |
| `app/db/database.py` | Connection setup (foreign keys, busy timeout, WAL), read/transaction contexts, schema version 1, initialization |
| `app/db/store.py` | Intent and step/audit persistence; audit is append-only |
| `app/permissions/policy.py` | Action risk and reversibility policy; approval always required |
| `app/intent/parser.py` | Deterministic command grammar → structured `ProposedAction`s |
| `app/intent/engine.py` | Proposal validation, state machine, approval binding, execution, verification, reporting |
| `app/tools/workspace.py` | Sandboxed filesystem operations and independent verification |
| `app/api/intents.py` | `/intents`, `/audit`, `/workspace` routes and error mapping |

## Intent workflow

```text
POST /intents
  UNDERSTAND  deterministic parse; unsupported text -> status "unrecognized"
  PLAN        validate targets against the sandbox; assess risk; persist plan
              unsafe/invalid -> status "blocked"
              valid        -> status "awaiting_approval" + challenge token
POST /intents/{id}/approve
  APPROVE     requires confirm=true and matching challenge -> "approved"
POST /intents/{id}/reject
              -> "rejected"; no execution
POST /intents/{id}/execute
  EXECUTE     only from "approved"; stops on first failure
  VERIFY      re-reads disk/hashes; all pass -> report; any fail -> "failed"
  REPORT      persists structured report, step events, audit entries -> "reported"
```

Rules enforced in code:

- Raw text from a model, microphone, or gesture is untrusted input. It can only become a typed, validated action.
- Execution is rejected unless the persisted status is exactly `approved`.
- Approval requires both `confirm: true` and the exact per-plan challenge, compared in constant time.
- A failure stops the run; remaining actions are not executed and the report says so.
- Verification is independent of the operation's own success return value.

## Storage layout

```text
data/
  bozz.sqlite3          # schema_meta, intents, intent_steps, audit_log
  workspace/            # the only root workspace tools may touch
    .trash/
      <UTC stamp>/...   # deleted items
      overwrites/...    # backups taken before an overwrite
```

SQLite is configured with WAL, `foreign_keys=ON`, and a 5 s busy timeout. Connections are opened per operation and always closed, which matters on Windows where open handles block directory cleanup. Audit rows have no update or delete methods.

## Trust boundaries

1. **Renderer → backend**: same-machine HTTP, CORS-restricted; no authentication because the server is loopback-only in the current single-user design.
2. **Backend → Ollama**: loopback HTTP by default; no third-party model provider is configured.
3. **Backend → disk**: only `data/workspace`; all paths are normalized and checked before use; `.trash` is inaccessible through the public tools.
4. **Browser sensors**: camera and microphone are requested by the browser, visibly indicated, stopped on disable, and not sent to the backend by current code.
5. **Browser storage**: `localStorage` is plain, profile-scoped storage, suitable only for non-sensitive UI data.

## Design constraints

- Target hardware is an 8 GB Windows machine with integrated graphics; the 3D engine is lazy-loaded and the backend avoids heavy dependencies (FastAPI, uvicorn, and the standard library only).
- Provider-specific code stays in `app/ai/*` behind the protocol; filesystem effects stay in `app/tools/*`; process/platform-specific code belongs in a future separate executor, not in the engine.
- Preview modules must remain visibly unavailable until a tested implementation exists.

## Extension points

- **New provider**: implement `AIProvider`, register it, expose its real status. No UI should infer connectivity.
- **New action type**: add parser output, policy entry, tool implementation, verification, and tests before exposing it.
- **Conversation memory**: add a SQLite store and API, then replace browser-only history with a reviewed retention/deletion flow.
- **OS executor**: a separate process with an action allowlist, capability grants, visible state, and a kill switch. It must never accept raw text.

## Known architectural gaps

- Chat/voice/gesture do not yet create intents; only the Intent Map form does.
- No authentication; do not expose the backend beyond loopback.
- No React error boundary.
- Electron is a development shell with no packaging or native IPC surface.
- The parser is a command grammar, not a language-model planner.
