# BOZZ API Design

The backend is a local FastAPI service. Development default: `http://127.0.0.1:8000`. The frontend calls `/api/*`; the Vite dev proxy removes `/api` and forwards to the backend. Backend routes are therefore prefix-free. The core is local-only. The optional ElevenLabs voice uses `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` from `backend/.env`; the key is never sent to the browser, logged, or returned by any endpoint.

## Endpoint summary

| Frontend path | Backend path | Method | Purpose |
| --- | --- | --- | --- |
| `/api/health` | `/health` | GET | Backend, database, workspace readiness |
| `/api/ai/status` | `/ai/status` | GET | Real provider/model availability |
| `/api/chat` | `/chat` | POST | Local-model conversation |
| `/api/intents` | `/intents` | POST | Propose an intent from text |
| `/api/intents` | `/intents` | GET | Recent intents (`limit` 1–100, default 20) |
| `/api/intents/{id}` | `/intents/{id}` | GET | Full intent view with steps and report |
| `/api/intents/{id}/approve` | `/intents/{id}/approve` | POST | Explicit approval with challenge |
| `/api/intents/{id}/execute` | `/intents/{id}/execute` | POST | Execute an approved plan |
| `/api/intents/{id}/reject` | `/intents/{id}/reject` | POST | Reject a pending plan |
| `/api/audit` | `/audit` | GET | Audit entries (`limit` 1–500, default 100) |
| `/api/workspace` | `/workspace` | GET | Workspace name, hint, and statistics |
| `/api/tts/status` | `/tts/status` | GET | Whether ElevenLabs is configured (no key or voice ID) |
| `/api/tts` | `/tts` | POST | Synthesize `{ text }` and return `audio/mpeg` |
| `/api/desktop/status` | `/desktop/status` | GET | Desktop mouse-adapter availability, state, screen size, gates |
| `/api/desktop/enable` | `/desktop/enable` | POST | Explicitly turn desktop mouse control on/off |
| `/api/desktop/stop` | `/desktop/stop` | POST | Latch the emergency stop |
| `/ws/desktop` | `/ws/desktop` | WS | Mouse command channel (token required, localhost only) |

`GET /` returns basic service metadata and version `0.2.0`.

## Error model

FastAPI returns `{"detail": "..."}`.

| Status | Meaning |
| --- | --- |
| 400 | Unsupported or invalid request (including unsupported action types or oversized TTS text) |
| 403 | Approval confirmation missing or challenge mismatch |
| 404 | Intent not found |
| 409 | Operation not valid for the intent's current state |
| 422 | Pydantic validation failure (limits, missing fields) |
| 429 | ElevenLabs quota or rate limit reached |
| 502 | ElevenLabs rejected the API key |
| 503 | Local provider or speech service unavailable, model missing, or timeout |
| 500 | Unexpected local error; generic message, details in backend log |

## Health

```http
GET /health
```

```json
{
  "status": "healthy",
  "service": "bozz-backend",
  "database": "ready",
  "workspace": "ready"
}
```

Readiness reporting reflects initialization performed in the app lifespan. It is not a synthetic ping.

## AI provider status

```http
GET /ai/status
```

```json
{
  "available": true,
  "provider": "ollama",
  "configured_model": "qwen2.5:1.5b",
  "models": ["qwen2.5:1.5b"],
  "detail": null
}
```

Fields reflect an actual `/api/tags` probe. When Ollama is down or the configured model is not installed, `available` is false and `detail` explains why.

## Chat

```http
POST /chat
Content-Type: application/json
```

```json
{
  "message": "Explain what a workspace sandbox is",
  "history": [
    { "role": "user", "content": "Previous question" },
    { "role": "assistant", "content": "Previous answer" }
  ]
}
```

Limits: `message` 1–12,000 characters; `history` at most 12 turns, each 1–12,000 characters. The backend prepends its own system prompt stating that the model cannot execute actions.

```json
{
  "reply": "...",
  "provider": "ollama",
  "model": "qwen2.5:1.5b",
  "local": true
}
```

If the provider fails, the response is 503 with a plain `detail`; no fabricated reply is returned.

## Speech status and synthesis

```http
GET /tts/status
```

```json
{
  "provider": "elevenlabs",
  "configured": true,
  "voice_configured": true,
  "model": "eleven_multilingual_v2",
  "max_chars": 500,
  "max_total_chars": 4000
}
```

No key material is included. `configured` requires both `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.

```http
POST /tts
Content-Type: application/json
```

```json
{ "text": "The reply to speak aloud." }
```

The backend splits text into chunks of at most 500 characters at sentence or word boundaries, requests each chunk from ElevenLabs, concatenates the MP3 bytes, and returns `200 audio/mpeg` with `Cache-Control: no-store`. Total text is capped at 4,000 characters. Missing configuration returns 503, an invalid key 502, and quota/rate limits 429, always as `{"detail": "..."}`. The frontend falls back to the browser speech engine on any failure and shows a small note.

## Propose an intent

```http
POST /intents
```

```json
{ "text": "create a file named demo/hello.txt containing: hello from BOZZ" }
```

`text` is 1–4,000 characters. Parsing is deterministic. Supported command families: list/ls, read/open/cat, create/make folder, create/write/overwrite file, append, delete, move/rename, search, workspace status. Unsupported text yields `status: "unrecognized"` with examples.

Response (abridged):

```json
{
  "id": "f1c2...",
  "text": "create a file named demo/hello.txt containing: hello from BOZZ",
  "status": "awaiting_approval",
  "understood": true,
  "approval_required": true,
  "approval_id": "per-plan-challenge",
  "message": "Plan ready: 1 action(s), highest risk medium. ...",
  "warnings": [],
  "examples": ["list files in demo", "read demo/hello.txt", "..."],
  "actions": [
    {
      "type": "workspace.write",
      "target": "demo/hello.txt",
      "description": "Write a file",
      "preview": "Create demo/hello.txt",
      "risk": "medium",
      "reversible": true
    }
  ],
  "steps": [
    { "step": "UNDERSTAND", "status": "done", "detail": "...", "at": "..." },
    { "step": "PLAN", "status": "done", "detail": "...", "at": "..." },
    { "step": "APPROVE", "status": "pending", "detail": "Waiting for explicit approval.", "at": "..." },
    { "step": "EXECUTE", "status": "pending", "detail": "Not started.", "at": "..." },
    { "step": "VERIFY", "status": "pending", "detail": "Not started.", "at": "..." },
    { "step": "REPORT", "status": "pending", "detail": "Not started.", "at": "..." }
  ],
  "report": null,
  "created_at": "...",
  "updated_at": "..."
}
```

Action payload details (file content) are stored server-side but are not returned in the public `actions` list for the current API.

### Intent statuses

| Status | Meaning |
| --- | --- |
| `unrecognized` | The text did not match a supported command |
| `blocked` | A recognized plan was rejected by validation (unsafe or invalid target) |
| `awaiting_approval` | Valid plan waiting for explicit approval |
| `approved` | Approval recorded; execution has not started |
| `rejected` | User rejected; nothing executed |
| `reported` | Execution and verification completed successfully |
| `failed` | Execution or verification failed; report explains where |

### Step statuses

`pending`, `running`, `done`, `blocked`, `skipped`, `error`.

## Approve

```http
POST /intents/{id}/approve
```

```json
{ "approval_id": "per-plan-challenge", "confirm": true }
```

Requires the current status to be `awaiting_approval`, `confirm: true`, and the exact challenge issued at proposal time. A wrong challenge returns 403; any other state returns 409. Approval is recorded in the audit log.

## Execute

```http
POST /intents/{id}/execute
```

No body. Requires status `approved`; otherwise 409. Actions run in order. The first failure stops the run, skips the rest, and produces `failed` with an error report. On success, each action is independently verified by re-reading the filesystem/hash, then the intent becomes `reported`.

Abridged completion report:

```json
{
  "status": "reported",
  "report": {
    "summary": "Completed 1 action(s) and verified all results.",
    "actions": [
      { "index": 1, "type": "workspace.write", "target": "demo/hello.txt", "ok": true, "detail": "Created 'demo/hello.txt' (33 bytes)." }
    ],
    "verification": [
      { "action": 1, "ok": true, "detail": "Verified 'demo/hello.txt' (33 bytes, sha256 ...)." }
    ],
    "finished_at": "..."
  }
}
```

## Reject

```http
POST /intents/{id}/reject
```

```json
{ "reason": "Not what I wanted" }
```

`reason` is optional, up to 500 characters. Requires `awaiting_approval`. Nothing executes; the steps and audit record the rejection.

## List intents

```http
GET /intents?limit=20
```

Returns `{"intents": [{id, raw_text, status, created_at, updated_at}, ...]}` newest first.

## Audit

```http
GET /audit?limit=100
```

Returns `{"entries": [...]}` newest first. Entry fields: `id`, `intent_id`, `event` (`propose`, `approve`, `reject`, `execute`, `verify`, `report`), `action_type`, `target`, `risk`, `outcome`, `detail`, `created_at`. The audit table is append-only; there are no update/delete API methods.

## Workspace summary

```http
GET /workspace
```

```json
{
  "name": "workspace",
  "path_hint": "data/workspace",
  "stats": { "files": 2, "folders": 1, "bytes": 57 }
}
```

`path_hint` is relative. The absolute path is intentionally not exposed to the renderer.

## Action types and risk

| Type | Risk | Reversible | Notes |
| --- | --- | --- | --- |
| `workspace.list` | low | yes | Directory entries |
| `workspace.read` | low | yes | Size-capped text read |
| `workspace.search` | low | yes | Result-capped search |
| `workspace.stats` | low | yes | Counts only |
| `workspace.mkdir` | low | yes | No-op if the folder exists |
| `workspace.write` | medium | yes | Refuses silent overwrite; explicit overwrite backs up |
| `workspace.append` | medium | no | Automatic undo is not available |
| `workspace.move` | medium | yes | No overwrite; no folder into itself |
| `workspace.delete` | high | yes | Moves to `.trash`, not erased |

Every action requires approval in this milestone, including reads.

## Desktop mouse control

Desktop control is a separate, opt-in adapter. It is **disabled by default** and
only reaches the operating system after an explicit enable call.

```http
GET /desktop/status
```

```json
{
  "available": true,
  "enabled": false,
  "emergency_stopped": false,
  "token": "session token generated at startup",
  "pyautogui": true,
  "pynput": true,
  "hotkey": false,
  "screen": { "width": 1920, "height": 1080 },
  "min_confidence": 0.7,
  "rate_limit": 60,
  "area": 0.8,
  "detail": null
}
```

`POST /desktop/enable` with `{"enabled": true|false}`. Enabling fails with 409
when the adapter is unavailable or the emergency stop is latched. `POST
/desktop/stop` latches the emergency stop until the backend restarts.

`WS /ws/desktop?token=...` accepts one JSON command per text frame. The socket
closes with code 1008 when the client is not local (the test client is
explicitly allowed) or the token does not match.

```json
{ "type": "move", "x": 0.5, "y": 0.4, "confidence": 0.91 }
{ "type": "click", "x": 0.5, "y": 0.4, "confidence": 0.91 }
{ "type": "drag_start", "x": 0.5, "y": 0.4, "confidence": 0.91 }
{ "type": "drag_move", "x": 0.6, "y": 0.4, "confidence": 0.88 }
{ "type": "drag_end", "x": 0.6, "y": 0.4, "confidence": 0.0 }
{ "type": "scroll", "delta": 12, "confidence": 0.9 }
{ "type": "configure", "area": 0.7, "sensitivity": 1, "smoothing": 0.35 }
```

Rules:

- Only `move`, `click`, `double_click`, `drag_start`, `drag_move`, `drag_end`,
  and `scroll` exist. Any other `type` is rejected.
- Normalised coordinates map into a centred rectangle (`area`) with an edge
  margin; values outside 0–1 are clamped.
- Commands below the confidence floor or above the sliding-window rate limit
  are rejected. `drag_end` bypasses the confidence check so a drag is always
  released; `configure` changes only the control area.
- The backend sends unsolicited `{"type": "state", ...}` frames when the
  enabled/emergency state changes, and a `reason` when a command is rejected.
- The random token is generated once at process startup, compared with
  `secrets.compare_digest`, and never written to a log.
- Actions are appended to `data/desktop-actions.log` (UTC timestamp, action,
  pixel/area). User landmarks and camera data are never written.

## Versioning

The current API is unversioned and intended for the bundled frontend only. Introduce `/v1` before breaking changes or third-party clients. New endpoints must have Pydantic schemas, an explicit permission decision, documented storage effects, contract tests, and a real error path.
