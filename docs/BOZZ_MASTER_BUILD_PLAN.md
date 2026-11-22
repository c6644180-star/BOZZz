# BOZZ — Master Build Plan

Last updated: 2026-11-22
Target: BOZZ Personal + BOZZ Firm + BOZZ Society, built as one privacy-first ecosystem.
Rule: this document is a target and execution plan, not a claim that every listed capability already exists.

## Product contract

BOZZ is a local-first assistant and user-directed capability co-creator. It should understand a request, produce a structured plan, explain its effects and permissions, request approval where needed, execute only through registered and scoped capabilities, verify the result, and report evidence.

The core lifecycle is:

`UNDERSTAND → PLAN → EXPLAIN → APPROVE → EXECUTE → VERIFY → REPORT`

For a request to create a new BOZZ capability:

`IDEA → BID → SPECIFICATION → SANDBOX BUILD → TEST → PERMISSION REVIEW → INSTALL APPROVAL → VERSION → ROLLBACK`

A BID (BOZZ Idea ID) preserves the user's original idea and tracks its evolution. A BID is not permission to execute or publish anything.

## Product surfaces

### BOZZ Personal
- Local-first chat, voice, gesture and keyboard input.
- Persistent conversations and user-controlled memory.
- Identity profiles and adaptive preferences.
- Intent Map and approval-controlled computer agent.
- Desktop actions with allowlists, clear sensor/action indicators, emergency stop and audit history.
- HGI gesture control and Mini Orb.
- Research and project workspaces.
- 3D model viewing and later engineering workflows.
- Personal communication assistance; sending messages or taking consequential actions requires explicit confirmation.
- Educational Market Analyzer: explain market data, technical/fundamental concepts and paper-trading simulations. No brokerage execution in this scope.

### BOZZ Capability Creator
- Capture an idea and create a unique BID.
- Preserve original wording and user ownership.
- Produce a versioned capability specification: purpose, inputs, outputs, dependencies, data access, actions, permissions, failure modes and tests.
- Build in a restricted workspace with no ambient access to the user's files, network, camera, microphone or desktop.
- Run deterministic tests and simulated tests before installation.
- Display a permission manifest and request separate approval for installation and later privileged actions.
- Install only signed/validated packages from the local registry.
- Maintain versions, changelogs, disable/uninstall and rollback.
- Never modify BOZZ core or its own security policy autonomously.

### BOZZ Firm
- Team/project workspaces, roles, tasks, documents and approved integrations.
- Employee profiles limited to work-relevant information.
- Transparent, consent-based collaboration and audit.
- Industrial/PLC work starts with read-only data, offline simulation and qualified review. No direct control of live machinery without a separate, professionally reviewed safety system.

### BOZZ Society
- Opt-in sharing of public capabilities, templates and community projects.
- Private-by-default ideas and memory.
- Explicit publishing, licensing, attribution, reporting and removal controls.
- No automatic sharing of private BID content.

## Implementation sequence

### Gate 0 — Repair and reproducibility
- Resolve current PR #1 CI failures.
- Make backend imports, tests, frontend tests and production build reliable.
- Reconcile stale project-status documents with actual test evidence.
- Keep main unchanged until review and passing checks.

**Exit gate:** clean backend compile/import/tests and frontend tests/build on CI.

### Gate 1 — Core data and identity correctness
- [x] Persist one active identity per local owner in SQLite.
- [x] Auto-select the first identity without overwriting a later user choice.
- [x] Enforce owner and active-status checks when switching.
- [x] Select a remaining active identity when the active identity is archived or deleted.
- [x] Upgrade existing schema-v4 databases and backfill a deterministic active identity.
- [x] Expose the active identity through the API and show it in Identity Manager.
- [x] Add regression tests for persistence across database connections, owner isolation, archive/delete fallback and schema upgrade.
- [ ] Bind memory records and retrieval to the active identity; verify cross-identity isolation.
- [ ] Persist conversations/messages with identity ownership and implement export/delete.
- [ ] Add tested database backup/restore and recovery flow.

**Exit gate:** restart-safe conversations; identity-isolated memory; deletion verified against the database. Gate 1 is not complete until the remaining unchecked items pass.

### Gate 2 — Intent and computer-action foundation
- [x] Typed action schemas reject unknown actions, parameters and invalid value types.
- [x] Planner output is constrained to registered action IDs and dependency ordering.
- [x] Deterministic server-side policy assigns action risk tiers; model-supplied tiers cannot lower policy.
- [x] Tier 3 actions fail closed before adapter execution.
- [x] Plan approval and per-step approval are separate; approval tokens expire.
- [x] Pending step approvals now display the exact action and privacy-conscious parameter preview.
- [x] Approval is fingerprint-bound to the exact action parameters; changed actions invalidate approval and stop the task.
- [x] Audit events record approval, denial, invalidation, action and verification outcomes.
- [x] Dry-run, cancellation, timeout, step/time caps, emergency stop and verification-evidence reporting have regression coverage.
- [ ] Add durable idempotency keys and recovery semantics for interrupted/retried actions.
- [ ] Add explicit permission scopes for file/app/device adapters before expanding beyond the constrained browser adapter.
- [ ] Expand end-to-end workflow coverage for the target Windows environment and verify all failure paths.

**Exit gate:** supported workflows run end-to-end; unsupported actions fail closed; every consequential action is attributable and auditable. Gate 2 remains open until remaining items and CI pass.

### Gate 3 — Voice and gesture
- Wake-word engine chosen through measured offline tests; no 100% reliability claim.
- Background mode is opt-in and visibly indicates microphone state.
- Camera is opt-in, visibly indicated, and stops immediately when disabled.
- Gesture confidence, calibration, debounce, false-trigger and latency benchmarks.
- Speech/gesture may create plans; they never silently approve risky actions.

**Exit gate:** repeatable tests on the target Windows PC, sensor-off tests and manual user acceptance.

### Gate 4 — Desktop and application workflows
- Windows desktop adapter with allowlisted actions.
- Browser automation through constrained, visible steps.
- Per-action confirmation for comments, messages, installs, deletes, purchases or external submissions.
- No stealth automation, hidden capture or unrestricted terminal access.

**Exit gate:** tested workflows, recovery paths, explicit user approval and audit record.

### Gate 5 — Capability Creator / BID
- BID version snapshots and restore.
- Capability manifest, sandbox runner, resource limits and test harness.
- Permission review and install approval.
- Package registry, update policy, disable/uninstall and rollback.
- Core integrity boundary: user-created capabilities cannot rewrite BOZZ's permission engine.

**Exit gate:** a sample user idea becomes a tested sandboxed capability, is installed only after approval, can be disabled and rolled back.

### Gate 6 — 3D, vision and devices
- Local file import with size/type limits.
- 3D inspection and project visualisation.
- User-selected image analysis with explicit camera/file permissions.
- Device adapters with documented protocols and simulation-first tests.

**Exit gate:** each adapter has a simulator, permission model, failure handling and hardware test record.

### Gate 7 — Firm and Society
- Firm roles, project spaces, employee collaboration and organization policies.
- Society opt-in publishing, capability discovery and licensing.
- Privacy boundaries between personal, firm and public data.

**Exit gate:** tenant/data isolation, access-control tests, audit, consent and removal flows.

### Gate 8 — Market Analyzer
- Educational market data ingestion with source/time stamps.
- Technical indicators and fundamental-data explanations.
- Risk education, scenario analysis and paper trading.
- No real-money trading execution in the initial product.

**Exit gate:** reproducible calculations, stale-data warnings, paper-trading ledger and clear educational disclaimers.

### Gate 9 — Packaging and release
- Windows installer, signed release artifacts, safe updates and recovery.
- Resource/performance budgets for the i3 / 8 GB / integrated-GPU target.
- Offline operation and optional online provider settings.
- Backup, restore, uninstall and data export.

**Exit gate:** clean-machine installation, upgrade, rollback and uninstall tests.

## Engineering rules

1. Preserve user data and existing behavior; do not rewrite unrelated modules.
2. Work on feature branches and use pull requests.
3. Never mark a feature complete from a UI mock, stub or documentation alone.
4. Every milestone needs positive-path and failure-path tests.
5. Keep model output untrusted. Validate it against typed schemas and server-side policy.
6. No model-generated code runs with ambient user permissions.
7. Keep secrets out of source control, logs and frontend bundles.
8. Keep camera/microphone off until the user enables them; show persistent state while active.
9. Use local/free components by default; optional online providers must be replaceable and clearly disclosed.
10. Target the known Windows i3 / 8 GB machine with performance budgets and graceful fallbacks.
11. Never claim CI, hardware testing or accuracy results unless evidence exists.
12. Update the status report after each verified milestone.

## Current evidence snapshot

- Gate 0 passed on commit `bda1228a55975451ee4f590df1ff06334665adf2`: backend compile/import checks, 32 backend tests, 221 frontend tests across 27 files and frontend production build.
- Gate 1 work is being developed separately on `feat/gate-1-persistence`, based on the Gate 0 repair branch.
- Gate 1 currently implements durable active identity selection, schema-v4 backfill, owner/status validation, archive/delete fallback, an active-identity API endpoint and Identity Manager status display.
- Gate 1 still requires its own CI run. No passing result is claimed until that run completes.
- Gate 2 implementation is being developed on `feat/gate-2-action-approval`, based on the Gate 1 branch; this preserves the staged dependency and does not change `main`.
- Gate 2 changes include action-bound approval challenges and an explicit action preview in the approval card. Gate 2 CI must pass before any completion claim.
- Existing repository UI/modules vary in maturity; the existence of a file or page is not proof of end-to-end reliability.
- PR #1 remains a draft. Main has not been changed or merged.

## Immediate next work

1. Complete and verify Gate 1, including identity-isolated memory, conversation persistence and backup/restore.
2. Run Gate 2 CI and resolve any failures in action-bound approvals and preview rendering.
3. Add durable idempotency and recovery semantics before expanding the executor.
4. Keep desktop, voice and gesture inputs behind the same typed action and approval boundary.
