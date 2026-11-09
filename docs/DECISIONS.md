# BOZZ Engineering Decisions

Recorded decisions are binding for the current milestone. Superseding a decision requires a new entry explaining why.

---

## 2026-11-08 — ADR-001: Ollama is the first AI provider

Ollama is installed locally with `qwen2.5:1.5b` available. BOZZ uses a small adapter behind an explicit `AIProvider` protocol so future providers can be added without changing UI conversation logic. Local-first and free.

Consequence: only one provider exists today; there is no model picker or streaming.

## 2026-11-08 — ADR-002: Provider HTTP calls use the standard library

The Ollama adapter uses `urllib` rather than adding an HTTP client package. This keeps install size and memory pressure low on 8 GB Windows hardware.

Consequence: no built-in retry/streaming convenience; timeout and error mapping are implemented manually.

## 2026-11-08 — ADR-003: No fallback scripted answers

An earlier UI produced rule-based replies that looked like model output. BOZZ now reports real provider failures and never fabricates a response. The same principle applies to system metrics and unavailable modules.

## 2026-11-08 — ADR-004: Chat history remains browser-local until memory is designed

Recent turns live in `localStorage` and are bounded. This is temporary continuity, not long-term memory. SQLite-backed conversations, export, and deletion belong to Milestone 2, with tests proving deletion is effective.

## 2026-11-08 — ADR-005: Desktop control remains absent

No Windows executor is included. A future executor must be a separate permissioned service with an action allowlist, capability grants, visible state, a kill switch, and an audit log. It must never accept arbitrary model, speech, or gesture text.

---

## 2026-11-08 — ADR-006: SQLite with append-only audit

Runtime state uses Python's `sqlite3` with WAL, foreign keys, and a 5 s busy timeout. Schema v1 has `intents`, `intent_steps`, `audit_log`, and `schema_meta`. Connections are opened per operation and always closed.

Why: a real persisted workflow needs durable state and an audit trail, and stdlib SQLite adds no dependency weight. Per-operation closing avoids Windows handle locks that blocked test cleanup.

Consequence: audit rows have no update/delete methods by design; schema migrations must be handled explicitly when v2 arrives.

## 2026-11-08 — ADR-007: Deterministic command parsing, not model-invented actions

The parser understands a fixed grammar for workspace commands and reports unsupported text. A language model is not asked to invent executable actions.

Why: the first tested action feature must be reliable and must not give a model an execution path. Deterministic parsing is testable and makes unsupported requests visible.

Consequence: free-form phrasing is limited; natural-language planning is a later milestone and must still produce schema-validated proposals.

## 2026-11-08 — ADR-008: Every action requires explicit approval

Even low-risk reads require approval in this milestone. Auto-approval is intentionally not implemented.

Why: approval behavior and audit coverage must be proven before any bypass exists. Risk levels inform the UI but do not currently relax the requirement.

Consequence: the workflow is more deliberate than a typical assistant; future auto-approval needs its own decision record and tests.

## 2026-11-08 — ADR-009: Approval is bound to a per-plan challenge

Proposal issues a `secrets.token_urlsafe(24)` challenge; approval requires `confirm: true` and a constant-time match. Execution requires exactly the `approved` state.

Why: prevents accidental or stale approval from being replayed against another plan, and makes approval explicit in both UI and API.

Consequence: the challenge is not time-limited yet; expiry is future work.

## 2026-11-08 — ADR-010: Deletes go to trash; overwrites keep backups

`delete` moves items to `data/workspace/.trash/<UTC stamp>/`. Explicit overwrite copies old content to `.trash/overwrites/` before `os.replace`.

Why: the directive forbids silently deleting or modifying important user files. Trash and backups provide a recovery path and make high-risk actions auditable.

Consequence: `.trash` grows without automatic purging; a user-facing recovery/purge flow is future work. Append is marked non-reversible.

## 2026-11-08 — ADR-011: Workspace tools are sandboxed to one root

All paths are normalized and must resolve inside `data/workspace`. Traversal, absolute paths, drives, UNC, ADS, reserved names, `~`, `.trash`, and escaping symlinks are rejected. Absolute paths are not exposed to the renderer.

Why: a personal assistant that can touch arbitrary disk paths is not acceptable without a much stronger permission model.

Consequence: BOZZ cannot act on user documents outside the workspace yet; importing files requires a future explicit selection/copy flow.

## 2026-11-08 — ADR-012: Intent workflow is the first real feature

The first milestone implements `UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT` against real workspace files, with verification re-reading disk and hashing results.

Why: the directive requires a real, testable feature rather than a visual demonstration. This exercises the backend, provider foundation, permission engine, persistence, and UI together.

Consequence: the UI demonstrates actions only through the deterministic grammar; chat/voice/gesture do not yet create intents.

## 2026-11-08 — ADR-013: Electron stays a development shell for now

The Electron entrypoint is hardened (Node integration off, context isolation on, sandbox on) but only loads the Vite development URL. No packaging, signing, or updater is included.

Why: packaging without a production loading strategy and update verification would imply readiness that does not exist.

Consequence: BOZZ currently runs as a browser app via Vite; desktop distribution is planned.

## 2026-11-08 — ADR-014: Known UI issues are recorded, not hidden

The duplicate `/vision` navigation path, missing React error boundary, and preview-only modules are documented in [PROJECT_STATUS.md](PROJECT_STATUS.md).

Why: honest status is required. These are scheduled fixes, not silent omissions.

Consequence: the duplicated nav entry resolves to one page; a render error can currently blank the shell until the boundary work is scheduled.
