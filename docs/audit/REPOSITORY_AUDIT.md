# Repository Audit — BOZZ AI

## Repository Structure

```
C:\Users\Marimuthu S\Documents\GitHub\BOZZz\
  backend/                    # FastAPI Python backend
    app/
      ai/                     # AI provider adapters (Ollama, ElevenLabs)
      api/                    # REST routes (chat, intents, files, desktop, etc.)
      core/                   # Config, logging
      db/                     # SQLite database + repositories
      files/                  # Spatial desktop file service
      intent/                 # Intent parser & engine
      modules/                # Module registry & permissions
      permissions/            # Action risk policy
      tools/                  # Sandboxed workspace tools
    requirements.txt
    .env
    .env.example
  frontend/                   # React + TypeScript + Vite
    src/
      pages/                  # Page components
      components/           # UI components (orb, chat, etc.)
      services/             # API clients (backend.ts, tts.ts, etc.)
      hooks/                # Custom React hooks
      types/                # TypeScript types
      adaptive/             # Adaptive/ui tuning features
      hgi/                    # Hand Gesture Intelligence
      holo/                   # Holographic viewer
      l3dme/                  # Local 3D viewer
      spatial/                # Spatial desktop
    dist/                     # Built output
    node_modules/
    package.json
    vite.config.ts
  data/                       # Local runtime state
    bozz.sqlite3              # SQLite database (WAL mode)
    workspace/                # Only workspace root BOZZ may act on
    workspace/.trash/         # Deleted/overwritten items
  docs/                       # Documentation (architecture, decisions, roadmap)
  tests/                      # Test suites
    backend/                  # Python unittest tests (29 tests passing)
    __tests__/                # Frontend Vitest tests
  scripts/
  start_bozz.bat              # Startup script (PowerShell)
  README.md
  THIRD_PARTY_LICENSES.md
```

## Existing Functionality (Functional)

### Backend (FastAPI + SQLite)

- **AI chat**: Local model via Ollama (`qwen2.5:1.5b`), replaceable provider registry
- **Intent workflow**: 6-step lifecycle (Understand → Plan → Approve → Execute → Verify → Report)
  - Deterministic command parser for workspace actions
  - Explicit approval with challenge token (`secrets.token_urlsafe(24)`)
  - Sandboxed workspace execution (restricted to `data/workspace/`)
  - Append-only audit log with verification
- **Workspace sandbox**: Path traversal protection, absolute path rejection, drive prefix rejection, `..` segment rejection, symlink escape prevention, size limits, `.trash` handling
- **Desktop mouse control**: OFF by default, three-tier allowlist (Tier 1 immediate, Tier 2 per-10s approval, Tier 3 blocked), emergency stop, confidence/rate gates
- **Text-to-speech**: ElevenLabs optional, backend-only key handling, browser fallback
- **Hand Gesture Intelligence**: MediaPipe camera pipeline, One Euro filtering, confidence-gated classifier, three modes (orb spin/zoom, in-page cursor, desktop mouse)
- **Module registry**: Per-module version, status, required permissions; permissions off by default, grantable in Settings, audited
- **Spatial Desktop**: Read-only workspace over user-allowed folders, card drag/resize/group, preview/open with OS default, executables shown but not opened
- **BCI Messages**: Local conversation storage, import/export, summaries, drafts, no send path
- **Agent**: Computer agent with task planning, approval, execution, verification; permission tiers (browser, admin, hardware); tier 3 actions blocked

### Frontend (React 19 + TypeScript + Vite)

- **Orb state display**: Real-time Three.js orb (lazy-loaded) showing app states (idle, listening, thinking, speaking, error, offline)
- **Command bar**: Slim bottom bar with real navigation chips, voice input, history/chat toggle
- **History panel**: Merges local chats with backend intent statuses, lazy-loaded
- **Settings panel**: Orb theme, reduce motion, background effects, orb size, compact chat
- **Intent Map page**: Live workflow console with plan previews, risk labels, approve/reject controls, verification results, audit trail, workspace stats
- **Modules page**: Module registry, permission grants, audit
- **Spatial page**: 3D workspace over allowed folders
- **Desktop control page**: Opt-in desktop mouse control toggles
- **Gesture page**: Gesture calibration, diagnostics, test modes
- **Chat page**: Local AI chat with replaceable provider
- **Voice provider**: Chat state, speech playback, browser fallback, stop/Escape

### Database (SQLite - `data/bozz.sqlite3`)

- **Schema version 4**
- Tables: `schema_meta`, `intents`, `intent_steps`, `audit_log`, `module_permissions`, `allowed_folders`, `spatial_layouts`, `bci_conversations`, `bci_messages`, `bci_drafts`, `bci_style`, `bci_settings`, `bci_provider_confirmations`, `agent_tasks`, `agent_steps`
- Foreign keys enabled, WAL mode, 5s busy timeout
- Append-only audit log (no update/delete methods)

### Permissions

- Explicit approval required for every action, including reads
- Challenge token comparison with `hmac.compare_digest`
- Risk assessment per action type (low/medium/high, reversible flag)
- Workspace restricted to `data/workspace/` with rigorous path validation
- No authentication; loopback-only single-user design

### Tests

- **Backend**: 29 tests passing (agent executor, planner, policy). Some tests have environmental dependencies (Ollama not required, agent tables need initialization).
- **Frontend**: Vitest tests passing (One Euro filtering, pinch hysteresis, coordinate mapping, classifier, L3DME exploded-view maths).
- **Build**: Production build passing.

## Existing Partially Implemented Features

- **Agent task tables** (`agent_tasks`, `agent_steps`): Schema exists but tables may not be initialized without explicit `db.initialize()` call.
- **BCI conversations/messages/drafts**: Schema present but feature is local-only with no send path.
- **Module permissions**: Store exists with CRUD operations, but UI integration is partial.
- **Spatial layouts**: Full CRUD API exists but depends on permission grants.

## Missing Features / Implementation Gaps

- **AI Identity Engine**: No identity management system exists. No model for custom AI identities, personality configuration, role/specialisation, greeting, voice, appearance.
- **Adaptive Personalisation Engine**: No preference profile system. Visual, behavioural, productivity, accessibility preferences not implemented.
- **BID (BOZZ Idea Identity) System**: No idea identity system with collision-resistant identifiers.
- **Human-Centred Communication Engine**: No configurable communication profiles (friendly, professional, diplomatic, etc.).
- **Workflow Creation Engine**: No structured workflow definition, validation, testing, approval system.
- **Safe Self-Evolution Foundation**: No module development scaffolding, code-generation, extension registry.
- **Creator Library**: No creation management, export/import of identities, workflows, extensions.
- **User preferences persistence**: No persistent preference store beyond what's in `localStorage`/`sqlite`.

## What Can Be Reused

- **AI provider registry**: `app/ai/registry.py` - protocol `AIProvider`, `ProviderStatus`, `LocalProviderError`. Ollama adapter already registered.
- **Intent workflow engine**: `app/intent/engine.py` - strict 6-step lifecycle with approval, can be extended.
- **Command parser**: `app/intent/parser.py` - deterministic workspace command understanding.
- **Workspace tools**: `app/tools/workspace.py` - sandboxed filesystem operations with verification.
- **Permission policy**: `app/permissions/policy.py` - action risk assessment, approval requirements.
- **Database layer**: `app/db/database.py` / `app/db/store.py` - SQLite with schema management, repositories.
- **API routes**: Existing `/api/*` routes provide patterns for new endpoints.
- **CORS configuration**: `http://localhost:5173` and `http://127.0.0.1:5173`.
- **Settings/config**: `app/core/config.py` - environment-driven frozen dataclass.
- **Logging**: `app/core/logging.py` - stderr handler.
- **Frontend API services**: `frontend/src/services/backend.ts` - typed API client patterns.
- **Vite proxy**: `/api` → `http://localhost:8000` prefix stripping.

## Architectural Risks and Dependencies

- **Database migration**: Adding new tables/columns requires migration plan; SQLite schema version must be incremented.
- **Backend-Frontend API contract**: New endpoints must match frontend expectations; Vite proxy strips `/api` prefix.
- **Permission model extension**: New capabilities require policy entries and UI permission toggles.
- **CORS**: Backend currently only allows `localhost:5173`; any new origins must be added carefully.
- **Model provider replaceability**: New identity personality/behaviour must not hardcode model-provider properties.
- **Windows hardware constraints**: 8 GB RAM, Intel UHD integrated graphics; avoid heavy local models as mandatory dependencies.
- **No authentication**: Backend is loopback-only; new multi-user features must not expose loopback beyond current design.

## Baseline Test Results

- **Backend**: 29/29 tests passing (OK) — agent executor, planner, policy tests
- **Frontend**: Vitest + lint + production build passing
- **Known pre-existing failures**: Some agent tests fail if `agent_tasks` table not initialized (environment issue, not code bug)