# Technical Debt — BOZZ AI

This document tracks known technical debt, shortcuts, and areas requiring attention in the BOZZ codebase. Each item is categorised by severity and includes a mitigation path.

## High Priority

### 1. Agent task tables not auto-initialized
- **Location**: `backend/app/agent/store.py`, `backend/app/agent/service.py`
- **Issue**: `agent_tasks` and `agent_steps` tables require explicit `db.initialize()` call. If the database is created without initialization, runtime errors occur (`no such table: agent_tasks`).
- **Severity**: High — causes crashes when agent features are used.
- **Mitigation**: Ensure `db.initialize()` is called in the backend lifespan (already called in `main.py` for other tables). Verify the agent store also initialises its tables. The `Database.initialize()` method uses `executescript(_SCHEMA)` which creates all tables including agent tables — confirm this is working or add explicit agent table initialization.

### 2. Database schema version mismatch
- **Location**: `backend/app/db/database.py` (`SCHEMA_VERSION = 4`)
- **Issue**: Schema version is 4 but the actual database may have been created with an older version. No migration code exists for upgrading from previous schemas.
- **Severity**: Medium — new deployments will upgrade, but in-place upgrades from older BOZZ versions may fail.
- **Mitigation**: Add migration scripts or ensure `initialize()` handles version detection and upgrade paths.

### 3. No type-safe API contracts for new features
- **Location**: All new endpoints would need Pydantic schemas.
- **Issue**: Existing API uses Pydantic models but there is no versioned contract (`/v1/`) yet. New features risk breaking changes.
- **Severity**: Medium — future-proofing risk.
- **Mitigation**: Introduce `/v1` API versioning before adding major new endpoint sets.

### 4. Frontend-b backend API drift risk
- **Location**: `frontend/src/services/backend.ts`, all `*.ts` service files.
- **Issue**: Frontend API types are hand-maintained; new backend endpoints must be manually mirrored in TypeScript.
- **Severity**: Low-Medium — manual sync risk.
- **Mitigation**: Generate TypeScript types from Pydantic models or document the contract explicitly.

## Medium Priority

### 5. Hardcoded model name in provider registry
- **Location**: `backend/app/ai/registry.py` (`default_name="ollama"`)
- **Issue**: The default provider is hardcoded to "ollama". Adding a new provider requires registry changes.
- **Severity**: Low — limited impact.
- **Mitigation**: Make provider registration fully dynamic via configuration.

### 6. Limited test coverage for new feature areas
- **Location**: `backend/tests/`, `frontend/__tests__/`
- **Issue**: Tests exist for agent, planner, policy, workspace, but no tests for identity management, personalisation, BID, communication profiles, workflows.
- **Severity**: Medium — risk of undetected regressions.
- **Mitigation**: Write tests alongside each new feature implementation (as required by Part 14).

### 7. ElevenLabs key in environment without validation
- **Location**: `backend/core/config.py`, `backend/.env`, `backend/.env.example`
- **Issue**: `ELEVENLABS_API_KEY` read from environment; no runtime validation until TTS is actually used.
- **Severity**: Low — only affects TTS feature.
- **Mitigation**: Add startup validation and clear error when TTS configured but key missing.

### 8. BCI "no send path" invariant not enforced in code
- **Location**: `app.bci.*`, `api.bci`
- **Issue**: Backend has no `/messages` send endpoint, but the invariant is documented, not code-enforced for all paths.
- **Severity**: Low — philosophical/design debt.
- **Mitigation**: Ensure no send-related routes are added; keep the invariant as a design principle.

### 9. No React error boundary coverage on all routes
- **Location**: `src/App.tsx` has `ErrorBoundary` but some route lazy-loads may not be covered.
- **Severity**: Low — partial coverage.
- **Mitigation**: Ensure all `<Route>` definitions wrap in `ErrorBoundary` or use `Suspense` properly.

### 10. Desktop control emergency stop not persisted across restarts
- **Location**: `backend/app/desktop/actions.py`
- **Issue**: Emergency stop latch is in-memory; restart clears the latch. No persistent state.
- **Severity**: Low — user must re-enable after restart.
- **Mitigation**: Store latch state in SQLite if persistent behavior is desired.

## Low Priority

### 11. Minimal error boundaries in lazy-loaded routes
- **Location**: `src/App.tsx` route definitions
- **Issue**: Some lazy-loaded pages (`ModelViewerPage`, `SpatialPage`, etc.) may not have error boundaries.
- **Severity**: Low — edge case.
- **Mitigation**: Add `ErrorBoundary` wrapper or ensure `Suspense` fallbacks are adequate.

### 12. LocalStorage not encrypted for sensitive UI data
- **Location**: `frontend/src/services/localStore.ts` (pattern used throughout)
- **Issue**: `localStorage` is plain text. Settings, chat history, project data stored here are not encrypted.
- **Severity**: Low — physical access required; not a threat model for single-user local.
- **Mitigation**: Document as known limitation; avoid storing sensitive data in localStorage.

### 13. CORS hardcoded to localhost origins
- **Location**: `backend/app/main.py` (`allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"]`)
- **Issue**: No configuration-driven CORS origins; changing port requires code change.
- **Severity**: Low — deployment convenience.
- **Mitigation**: Make CORS origins configurable via environment.

### 14. Cached provider registry (lru_cache) may stale
- **Location**: `backend/app/ai/registry.py` (`@lru_cache(maxsize=1)` on `get_registry()`)
- **Issue**: Registry is cached for process lifetime. Settings changes (e.g., switching providers) not reflected without restart.
- **Severity**: Low — restart required for provider switch.
- **Mitigation**: Remove cache or make it invalidate on settings change.

### 15. Tenant of dead code / unused imports
- **Location**: Various files across backend and frontend.
- **Issue**: Code cleanup opportunities identified during audit.
- **Severity**: Very Low — cosmetic.
- **Mitigation**: Run linter (`ruff`, `eslint`) and remove unused imports.

## Debt Reduction Plan

| Priority | Item | Target Resolution |
| --- | --- | --- |
| High | Agent table initialization | Ensure `db.initialize()` covers all tables in lifespan |
| High | Schema migration path | Add version detection + upgrade script |
| Medium | API versioning (`/v1`) | Introduce before major new endpoint sets |
| Medium | Test coverage for new phases | Write tests per Phase 1–7 requirements |
| Low | CORS configurability | Make origins env‑variable driven |
| Low | Error boundary coverage | Ensure all routes covered |