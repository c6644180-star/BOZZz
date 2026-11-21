# Implementation Gap Analysis — BOZZ AI Major Expansion

This document analyses the gaps between the existing BOZZ architecture and the major expansion requirements specified in the product specification. Each gap is evaluated for effort, risk, and dependency order.

## Gap Classification

| Category | Description |
| --- | --- |
| **Identity Management** | AI identity create/rename/edit/switch/delete, multiple identities, memory boundaries |
| **Personalisation Engine** | Preference profiles (visual, behavioural, productivity, accessibility), safe config-change workflow |
| **BID System** | Collision-resistant idea identifiers, idea lifecycle, version history, search/link/archive |
| **Communication Engine** | Configurable communication profiles (friendly, professional, diplomatic, etc.), integration with AI response pipeline |
| **Workflow Engine** | Structured workflow definitions, validation, testing, approval, execution, versioning, rollback |
| **Self-Evolution Foundation** | Extension manifests, module scaffolding, static validation, test generation, isolated test execution |
| **Creator Library** | Private creation management, listing, version info, export/import validation |

## Priority Order & Dependencies

| Phase | System | Dependencies | Effort Estimate | Risk |
| --- | --- | --- | --- | --- |
| 1 | AI Identity Engine | Backend API patterns, SQLite, existing auth (none), provider registry | High (new model, new API, new UI) | Medium |
| 2 | Adaptive Personalisation Engine | Identity engine (preferences linked to identities), existing settings UI | Medium | Low |
| 3 | BID System | Idea records, SQLite extensions, versioning logic | Medium | Low |
| 4 | Communication Engine | AI response pipeline (existing `/chat`), preference profiles (Phase 2) | Medium | Low |
| 5 | Workflow Creation Engine | Permission system (existing), workspace tools (existing), approval flow (existing) | High | Medium |
| 6 | Safe Self-Evolution Foundation | Module registry (existing), permission system, isolated testing | High | Medium |
| 7 | Creator Library Foundation | Identity engine (Phase 1), workflow engine (Phase 5), BID system (Phase 3) | Medium | Low |

## Detailed Gap Analysis

### Phase 1: AI Identity Engine — High Effort, Medium Risk

**What's missing:**
- Identity data model (SQLite tables, Pydantic schemas)
- Repository/data-access layer for identities
- Service layer with business logic (create, rename, switch, archive, delete)
- API routes (`/api/identities`, `/api/identities/{id}`, etc.)
- Frontend identity-management UI
- Memory boundary enforcement (duplicated identities don't inherit private memories)
- Identity switching with independent configuration

**Reuse existing:**
- SQLite database layer (`app.db.database`, `app.db.store`)
- API router pattern (`app.api.intents`, `app.api.files`)
- Permission policy framework (`app.permissions.policy`)
- Intent workflow engine (for approval flow patterns)
- Settings/config framework (`app.core.config`)
- CORS and HTTP error model

**New components needed:**
- `Identity` Pydantic model + SQLite repository
- `IdentityService` with business logic
- `/api/identities/*` routes
- Frontend `IdentityManager` component/page
- Memory ownership rules in service layer
- Identity switching state management

**Risk factors:**
- Identity data must not corrupt existing intent/workspace data
- Switching identities must not expose another identity's private data
- Multiple identities coexisting must share the same workspace sandbox (or have isolated workspaces)
- Backward compatibility: existing intents/projects must remain accessible

### Phase 2: Adaptive Personalisation Engine — Medium Effort, Low Risk

**What's missing:**
- Preference profile data model linked to identities
- Visual preferences (theme, background, effects)
- AI behaviour preferences (personality traits, response style)
- Productivity preferences (shortcuts, default modes)
- Accessibility preferences (reduce motion, high contrast)
- Functional preferences (save/load, preview/approve workflow)
- Privacy preferences (data retention, export/delete)
- Reset/export/delete preference operations
- Safe configuration-change workflow (UNDERSTAND → IDENTIFY → PREVIEW → APPROVE → APPLY → VERIFY → SAVE)

**Reuse existing:**
- Settings framework (`app.core.config.Settings`) — can be extended
- Theme system (`frontend/src/styles/orbTheme.ts`, `App.tsx` `root.dataset.theme`)
- Reduce motion setting already partially exists
- Permission approval flow (can be reused for config changes)
- LocalStorage patterns for transient preferences

**New components needed:**
- `PreferenceProfile` Pydantic model + SQLite repository
- Preference service layer with validation
- `/api/preferences/*` routes
- Frontend preference configuration UI
- UNDERSTAND → IDENTIFY → PREVIEW → APPROVE → APPLY → VERIFY → SAVE workflow engine
- Communication of preference changes to backend API

**Risk factors:**
- Preference changes must not break existing functionality
- Safe workflow must prevent arbitrary code execution
- Reset must restore to known-good defaults
- Must not grant tool permissions or override security policies

### Phase 3: BID System — Medium Effort, Low Risk

**What's missing:**
- BID (BOZZ Idea Identity) data model with collision-resistant identifiers
- Idea records with full provenance (original text, AI interpretation, version history)
- Create/retrieve/search/edit/archive/delete operations
- Version comparison and linking related ideas
- Private-idea-default privacy
- Export functionality

**Reuse existing:**
- UUID generation patterns (already used for intent IDs)
- SQLite repository patterns
- Version tracking concepts (intent steps)
- Search existing workspace search infrastructure

**New components needed:**
- `BID` generation (collision-resistant, non-PII format like `BOZZ-ID-7F29A81C`)
- `Idea` Pydantic model with version history
- `BIDRepository` for CRUD + search by description/category/project
- `/api/bids/*` routes
- Frontend BID management UI
- Version comparison logic
- Private-idea privacy defaults

**Risk factors:**
- BID collision resistance must be verified (UUIDv4 or hash-based)
- Original idea text must never be silently replaced by AI interpretation
- Privacy defaults must keep private ideas private by default
- No automatic community publishing

### Phase 4: Communication Engine — Medium Effort, Low Risk

**What's missing:**
- Communication profile data model (linked to identities)
- Profile definitions: Friendly, Professional, Diplomatic, Strategic, Educational, Motivational, Leadership, Concise, Detailed, Creative, Analytical, Empathetic, User-defined
- Profile adaptation of AI response style
- Integration with existing AI response pipeline
- Constructive feedback, uncertainty admission, avoidance of artificial praise/fabricated evidence/deceptive persuasion

**Reuse existing:**
- AI provider chat pipeline (`app.ai.ollama`, `app.ai.registry`, `app.api.chat`)
- Settings/preferences system (Phase 2)
- Existing intent workflow for approval of style changes

**New components needed:**
- `CommunicationProfile` Pydantic model + SQLite repository
- Profile adaptation middleware for AI responses
- `/api/communication/profiles/*` routes
- Frontend communication profile selector
- Response style adaptation logic (prompt engineering, not new model)
- Admission of uncertainty protocol
- Artificial praise/fabricated evidence/deceptive persuasion avoidance rules

**Risk factors:**
- Must not create a separate AI model — must adapt existing responses
- Profile must respect security policies and permission boundaries
- Must not fabricate evidence or give artificial praise
- User-defined profiles must be validated against allowed principles

### Phase 5: Workflow Creation Engine — High Effort, Medium Risk

**What's missing:**
- Workflow data model (ID, name, description, steps, tools, inputs/outputs, permissions, version, status)
- UNDERSTAND → PLAN → DESIGN → VALIDATE → TEST → APPROVE → INSTALL → VERIFY lifecycle
- Workflow creation inspection/validation
- Only registered, approved tools may be used
- Execution through approved tools only
- Execution logs and error handling
- Versioning and rollback
- Do not allow arbitrary natural-language instructions to bypass permission system

**Reuse existing:**
- Intent workflow engine (6-step lifecycle patterns)
- Workspace tools (sandboxed execution)
- Permission policy (action risk assessment)
- Module registry (approved tools list)
- API route patterns

**New components needed:**
- `Workflow` Pydantic model + SQLite repository
- Workflow step definition model
- `/api/workflows/*` routes
- Workflow inspection/validation UI
- Tool registration and approval check
- Execution log storage
- Version diff and rollback mechanism
- Permission declaration per workflow step

**Risk factors:**
- Must not allow arbitrary NL instructions to bypass permission system
- Only registered/approved tools may be used
- Rollback must not damage working installation
- Execution logs must be complete and accurate
- Version diff must be meaningful

### Phase 6: Safe Self-Evolution Foundation — High Effort, Medium Risk

**What's missing:**
- Capability Development Agent architecture
- Module templates and scaffolding
- Code-generation interface (restricted)
- Extension manifest with permission/dependency declarations
- Dependency declaration system
- Isolated testing interface
- Automated test execution
- Extension registry
- Installation approval
- Version management
- Rollback mechanism

**Reuse existing:**
- Module registry (`app.modules.registry`)
- Permission policy (`app.permissions.policy`)
- Workspace sandbox (`app.tools.workspace`)
- Intent workflow (approval flow)
- Test infrastructure (29 backend tests)

**New components needed:**
- Extension manifest schema
- Module scaffolding generator
- Static validation pipeline (JSON schema, type checks)
- Test generation interface
- Isolated test execution environment (subprocess, not direct OS access)
- Permission review UI
- User approval flow for installed extensions
- Version history and rollback logic
- Controlled registration API

**Risk factors:**
- Generated modules must never receive unrestricted OS access
- Must not execute arbitrary model-generated shell commands directly
- Protected BOZZ core files must not be modified automatically
- Installation approval must be explicit user action
- Rollback must not damage working installation

### Phase 7: Creator Library Foundation — Medium Effort, Low Risk

**What's missing:**
- Listing created identities, saved workflows, approved extensions
- Creation details and version information
- Export functionality with dependency/permission/compatibility info
- Import validation
- Future-sharing preparation (not automatic publishing)

**Reuse existing:**
- Identity engine (Phase 1) — listing created identities
- Workflow engine (Phase 5) — listing saved workflows
- Module registry (existing) — approved extensions
- Export/import patterns from existing features

**New components needed:**
- Creator library listing UI
- Export bundles (identity/workflow/extension metadata + dependencies)
- Import validation logic
- Dependency/permission/compatibility reports
- Private-only-first approach (no auto-upload/publish)

**Risk factors:**
- Private ideas/memories/project files must never be uploaded automatically
- Publishing must be explicit user action
- Import must validate dependencies and permissions before applying

## Cross-Cutting Concerns

### Database Migration
- Schema version must be incremented for each new feature set
- Migration scripts needed for in-place upgrades
- Backward compatibility with existing data is critical

### API Contract Versioning
- Current API is unversioned (`/api/*`)
- Introduce `/v1/` prefix before breaking changes
- New endpoints must have Pydantic schemas, permission decisions, documented storage effects, contract tests, real error paths

### Permission Model Extension
- Each new capability requires policy entries
- UI permission toggles needed
- Challenge token approval flow may need adaptation for new contexts

### CORS and Deployment
- Backend currently only allows `localhost:5173` and `127.0.0.1:5173`
- Any new deployment origins must be added carefully
- Consider making CORS origins configurable

### Frontend-Backend API Synchronisation
- New endpoints must match frontend TypeScript types
- Manual sync risk; consider type generation from Pydantic models
- All API calls go through Vite proxy (`/api` → `http://localhost:8000`)

### Test Strategy
- Write tests before or alongside implementation (Part 14 requirement)
- Backend: unittest with coverage of new models, services, API routes
- Frontend: Vitest + React Testing Library for UI components
- Integration: End-to-end identity switching, preference changes, workflow execution
- Regression: Ensure existing features still pass

### Windows Hardware Constraints
- Target: Intel Core i3-1115G4, 8 GB RAM, Intel UHD integrated graphics
- Avoid heavy local models as mandatory dependencies
- Keep local-first functionality possible
- Model providers must remain replaceable
- Online services optional where possible

### Security Requirements Compliance
- No unrestricted self-modification
- No silent installation
- No arbitrary personal-file access
- No hidden camera/microphone activation
- No automatic private-data uploads
- No automatic idea publishing
- No OS security bypass
- No hidden consequential actions
- Every extension must declare permissions and dependencies
- Users must be able to inspect active extensions and revoke permissions
- Failed installations must not damage working BOZZ installation
- Maintain logs, backups, recovery and rollback mechanisms