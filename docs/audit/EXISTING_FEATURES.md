# Existing Features — BOZZ AI

This document catalogues all functional features currently implemented and tested in the BOZZ repository as of the audit date. Features are grouped by system and marked for reuse, modification, or new implementation.

## Backend Services

| Feature | Module | Status | Notes |
| --- | --- | --- | --- |
| AI chat / conversation | `app.ai.ollama`, `app.ai.registry`, `app.api.chat` | Fully functional | Local Ollama model `qwen2.5:1.5b`; provider registry supports replaceable adapters. |
| Intent workflow (6-step) | `app.intent.parser`, `app.intent.engine`, `app.api.intents` | Fully functional | UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT. Deterministic parser. Explicit approval with challenge token. |
| Workspace actions (sandboxed) | `app.files.service`, `app.files.store`, `app.tools.workspace`, `app.db.store` | Fully functional | Path traversal, absolute paths, drive prefixes, `..`, UNC, ADS, symlinks rejected. `.trash` move on delete. Size limits enforced. |
| Desktop mouse control | `app.desktop.controller`, `app.desktop.actions`, `app.api.desktop` | Fully functional (opt-in) | OFF by default. Three-tier allowlist. Emergency stop. Confidence/rate gates. WebSocket with token auth. |
| Text-to-speech (ElevenLabs) | `app.ai.elevenlabs`, `app.api.tts` | Fully functional (optional) | Server-only key handling. Browser fallback on failure. Chunked synthesis. |
| Hand Gesture Intelligence | `app.hgi.service`, `app.hgi.classifier`, `app.hgi.storage` | Fully functional | MediaPipe one pipeline. One Euro filtering. Confidence-gated classifier. Three modes. Diagnostics. |
| Module registry & permissions | `app.modules.registry`, `app.permissions.policy`, `app.api.modules` | Fully functional | Per-module version/status/permissions. Grants off by default. Auditable. |
| Spatial desktop | `app.files.service`, `app.files.store`, `app.files.paths`, `app.api.files` | Fully functional | Read-only over user-allowed folders. Card drag/resize/group. Preview/open with OS default. Executables shown but not opened. |
| BCI conversation storage | `app.bci.service`, `app.bci.store`, `app.api.bci` | Local-only | No send path. Import/export supported. Retention controls. Drafts marked "not sent". |
| Agent task execution | `app.agent.service`, `app.agent.store`, `app.agent.policy` | Functional (initial) | Task planning with approval. Permission tiers (browser, admin, hardware). Tier 3 actions blocked. |

## Frontend UI

| Feature | Component/Page | Status | Notes |
| --- | --- | --- | --- |
| Orb state display | `src/components/orb/Orb.tsx` | Fully functional | SVG arc-reactor orb. Real-state animation. Cyan/Gold theme. Saved in localStorage. |
| Voice wave visualisation | `src/components/orb/VoiceWave.tsx` | Fully functional | 28 bars from live frequency data. Speech analyser glow. |
| Command bar | `src.components.chat.CommandBar.tsx` | Fully functional | Slim bottom bar. Send, mic/stop. Navigation chips. |
| History panel | `src.components.history.HistoryPanel.tsx` | Fully functional | Slide-over. Merges local chats with backend intent statuses. Lazy-loading. |
| Settings panel | `src.pages.SettingsPage` | Fully functional | Orb theme, reduce motion, background effects, orb size, compact chat. |
| Intent Map page | `src.pages.IntentMapPage.tsx` | Fully functional | Live workflow console. Plan previews. Risk labels. Approve/reject. Verification results. Audit trail. Workspace stats. |
| Chat page | `src.pages.ChatPage` | Fully functional | AI conversation via backend `/api/chat`. Provider status. |
| Modules page | `src.pages.ModulesPage` | Fully functional | Module registry. Permission grants. Audit. |
| Spatial page | `src.pages.SpatialPage` | Fully functional | 3D workspace over allowed folders. Card drag/resize/group. |
| Desktop control page | `src.components.hgi.DesktopControlSlideOver` | Fully functional (opt-in) | Toggle enable/disable. Tier status. |
| Gesture page | `src.pages.GesturePage` | Fully functional | Calibration, diagnostics, test modes. |
| Top bar | `src.components.layout.TopBar` | Fully functional | Status dot, orb state, voice indicators. |
| Slide-over panels | `src.components.layout.SlideOver.tsx` | Fully functional | Focus trap, Escape, scroll lock. |
| Error boundary | `src.components.ErrorBoundary` | Fully functional | React error boundary. |
| Voice provider | `src.components.BozzVoiceProvider.tsx` | Fully functional | Chat state, speech playback, browser fallback, stop/Escape. |
| HUD frame | `src.components.hud.HudFrame` | Fully functional | Top-status display. |

## Database Models

| Table | Purpose | Status |
| --- | --- | --- |
| `schema_meta` | Schema version tracking | Implemented |
| `intents` | Intent Map proposals and status | Implemented |
| `intent_steps` | Step lifecycle per intent | Implemented |
| `audit_log` | Append-only audit trail | Implemented |
| `module_permissions` | Per-module permission grants | Implemented |
| `allowed_folders` | User-allowed folder roots | Implemented |
| `spatial_layouts` | Saved spatial desktop layouts | Implemented |
| `bci_conversations` | BCI conversation headers | Implemented (local-only) |
| `bci_messages` | BCI conversation messages | Implemented (local-only) |
| `bci_drafts` | BCI draft messages | Implemented (local-only) |
| `bci_style` | BCI style preferences | Implemented (local-only) |
| `bci_settings` | BCI settings key-value | Implemented (local-only) |
| `bci_provider_confirmations` | Provider confirmations | Implemented (local-only) |
| `agent_tasks` | Agent task tracking | Schema present; init required |
| `agent_steps` | Agent step tracking | Schema present; init required |

## API Endpoints (Existing)

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Backend, database, workspace readiness |
| `/api/ai/status` | GET | AI provider/model availability |
| `/api/chat` | POST | Local-model conversation |
| `/api/intents` | POST | Propose intent from text |
| `/api/intents` | GET | List intents (limit 1–100) |
| `/api/intents/{id}` | GET | Full intent view |
| `/api/intents/{id}/approve` | POST | Explicit approval with challenge |
| `/api/intents/{id}/execute` | POST | Execute approved plan |
| `/api/intents/{id}/reject` | POST | Reject pending plan |
| `/api/audit` | GET | Audit entries (limit 1–500) |
| `/api/workspace` | GET | Workspace summary |
| `/api/tts/status` | GET | TTS configuration status |
| `/api/tts` | POST | Synthesize speech |
| `/api/desktop/status` | GET | Desktop mouse status |
| `/api/desktop/enable` | POST | Enable/disable desktop control |
| `/api/desktop/stop` | POST | Latch emergency stop |
| `/ws/desktop` | WS | Mouse command channel |

## Trust Boundaries (Existing)

1. **Renderer → backend**: same-machine HTTP, CORS-restricted; no authentication (loopback-only).
2. **Backend → Ollama**: loopback HTTP; no third-party provider configured.
3. **Backend → disk**: only `data/workspace`; all paths normalized and checked.
4. **Browser sensors**: camera/microphone visibly indicated, stopped on disable, not sent to backend.
5. **Browser storage**: `localStorage` plain, profile-scoped; suitable for non-sensitive UI data only.

## Design Constraints (Existing)

- Target hardware: 8 GB Windows with integrated graphics.
- Provider-specific code stays in `app/ai/*` behind protocol.
- Filesystem effects stay in `app/tools/*`.
- Preview modules must remain visibly unavailable until tested implementation exists.
- No authentication; do not expose backend beyond loopback.

## Known Architectural Gaps (Existing)

- Chat/voice/gesture do not yet create intents (only Intent Map form does).
- No authentication; do not expose backend beyond loopback.
- No React error boundary (one exists now but not used everywhere).
- Electron is development shell with no packaging or native IPC.
- Parser is command grammar, not language-model planner.
- No persistent user preference profiles beyond transient localStorage.