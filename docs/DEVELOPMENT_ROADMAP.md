# BOZZ Development Roadmap

Last updated: 2026-11-08
Principle: each milestone must produce a real, testable capability, keep all earlier tests green, and update [PROJECT_STATUS.md](PROJECT_STATUS.md). Planned work is never described as available.

## Phase 0 — Audit and foundation documentation

**Status: complete (2026-11-08).**

- Inspected the full repository, dependencies, runtime, and existing behavior.
- Added backend dependency manifest, environment example, logging, tests, and this documentation set.
- Recorded known issues instead of hiding them.

## Milestone 1 — Backend foundation and actionable intent workflow

**Status: complete and tested (2026-11-08).**

Delivered:

- SQLite schema v1 (`intents`, `intent_steps`, `audit_log`, `schema_meta`) with WAL and append-only audit.
- Replaceable provider registry and a stdlib Ollama adapter; verified `qwen2.5:1.5b` chat.
- Sandboxed workspace tools with traversal/symlink/UNC/ADS rejection, size caps, atomic writes, backups, and trash-based deletes.
- Risk policy and explicit approval bound to a per-plan challenge.
- Deterministic command parser with explicit unsupported reporting.
- Six-step intent engine (`UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT`) with status transitions, failure reporting, and disk verification.
- Intent Map console with live history, audit, and workspace statistics.
- 27 backend tests; lint/build green; live HTTP and browser verification.

Deliberate limits: workspace actions only; one provider; command grammar, not free-form planning; approval required even for reads; no OS-level actions.

## Milestone 2 — Conversation and contextual memory persistence

**Status: next recommended milestone.**

Goal: move chat continuity out of `localStorage` into a reviewed local store, and give BOZZ a memory model users can inspect and delete.

Scope:

- SQLite tables for conversations, messages, and memory entries with schema migration to v2.
- Backend endpoints for listing/reading conversations, appending messages, deleting a conversation, and exporting data.
- Context assembly: bounded recent turns plus explicitly selected memory, with a visible token/character budget.
- Memory lifecycle: create, edit, pin, delete, and "forget all", with confirmation for bulk deletion.
- Frontend: replace browser-only chat history; show when memory is used; clearly separate stored conversation from model context.
- Tests: retention bounds, deletion actually removes rows/files, context never exceeds budget, failures do not lose the user's message silently.

Acceptance: a restart preserves conversations and memory; export produces a readable file; deletion is immediate and audited; no chat text is sent anywhere except the configured loopback model.

Non-goals: semantic vector search, cloud sync, hidden profiling.

## Milestone 3 — Voice and gesture as first-class inputs

**Status: planned.**

- Push-to-talk and wake-free explicit voice capture with a persistent microphone indicator and immediate stop.
- Voice transcripts create **proposals**, never direct execution.
- Dedicated Voice Studio page (currently `available: false`).
- Gesture: evaluate MediaPipe hand landmarks only after calibration, confidence thresholds, throttling, camera-off control, and fixture-based tests exist. Replace pixel-motion preview only when the replacement is measurably better.
- Tests for permission gating, cancellation, and "sensor off means no processing".

Acceptance: speech and gestures can propose a supported workspace action end-to-end while still requiring approval; disabling a sensor stops processing immediately.

## Milestone 4 — Richer local AI planning

**Status: planned.**

- Provider configuration UI and model selection based on real `/ai/status` data.
- Structured proposal generation from natural language constrained to the allowed action schema.
- Streaming responses with cancellation and timeout handling.
- Prompt-injection resistance tests: model output cannot bypass validation, policy, or approval.

Acceptance: free-form phrasing produces a reviewed plan for supported actions; unsupported or unsafe requests are refused with a clear explanation.

## Milestone 5 — Spatial Desktop foundation

**Status: planned.**

- Saved workspace/layout model with pointer and keyboard controls.
- A spatial surface that operates on the same typed action model rather than bypassing it.
- Performance budget measured on 8 GB integrated-graphics hardware.

## Milestone 6 — 3D Engineering Studio

**Status: planned.**

- Local model import, scene management, and export with size/format limits.
- Explicit file-selection permission flow.

## Milestone 7 — Vision and hardware

**Status: planned / partially blocked.**

- User-selected image inputs, local analysis, and clear retention rules.
- Hardware adapters require a protocol, safety limits, and a separate permission model. No hardware control is implemented.
- Desktop/OS control remains **blocked** until a separate permissioned executor with an allowlist, visible state, kill switch, and audit is designed and tested.

## Later vision modules

**Status: planned, not started.**

- BOZZ Firm, BOZZ Society, and the educational Market Analyzer are product-level modules. They depend on stable identity, memory, permissions, and audit foundations. They are not part of current milestones and must not be advertised as working.

## Ordering rationale

The directive's priority order is: core backend, local providers, conversation/memory, permissions, intent workflow, voice, gestures, spatial, 3D, vision/hardware. Milestone 1 covered the backend, provider foundation, permissions, and intent workflow because they are prerequisites for any safe input mode. Conversation/memory is next because chat currently lives only in the browser and is the largest remaining gap in the personal-assistant foundation. Voice and gesture come after memory so that new input modes feed a durable, reviewable context.

## Milestone gate

A milestone is complete only when:

1. The capability works end-to-end against the real backend or hardware.
2. Automated tests cover the critical path and at least one failure path.
3. Lint and build pass.
4. Security/permission effects are documented and audited.
5. [PROJECT_STATUS.md](PROJECT_STATUS.md) and [DECISIONS.md](DECISIONS.md) are updated with verified evidence.
