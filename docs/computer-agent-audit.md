# BOZZ Universal Computer Operation & Application Intelligence Engine — Milestone 1 audit

Audit date: 2026-11-09. Scope: the repository as it exists before this
milestone. This document is a factual inventory. It does not claim a capability
is working unless the listed code path is wired and reachable.

## 1. What already exists and is reusable

### 1.1 Intent workflow and the Intent Map

| Piece | Location | Reuse in this milestone |
| --- | --- | --- |
| Strict workflow engine (UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT) with an approval challenge bound to each plan | `backend/app/intent/engine.py` | Kept untouched. Agent tasks get their own engine because the agent run loop is step-based, but it copies the same rules: explicit approval, real evidence, append-only audit. |
| Stage/evidence rules; a task may not be reported `done` without evidence | `backend/app/intent/stages.py` | Evidence-source rule is mirrored by the agent's four result levels. |
| Deterministic workspace command parser | `backend/app/intent/parser.py` | Not changed. The agent never routes natural language into this parser. |
| Intent Map UI and `/intents` routes | `frontend/src/pages/IntentMapPage.tsx`, `backend/app/api/intents.py` | Kept untouched. The Agent panel is a separate flow. |
| SQLite intents, steps and append-only audit tables | `backend/app/db/database.py`, `backend/app/db/store.py` | Audit table is reused for agent events. New agent task/step tables are additive. |

### 1.2 Desktop Control v2

| Piece | Location | Reuse |
| --- | --- | --- |
| Single source of executable action ids, tiers 1–3, typed parameter schemas | `config/desktop_actions.json`, `backend/app/desktop/actions.py` | Not modified. The agent policy engine maps its own action ids onto the same tier semantics (1 = immediate read-only, 2 = per-action approval, 3 = blocked). |
| URL normalisation (only `http`/`https`, no embedded credentials) | `backend/app/desktop/actions.py` (`normalize_url`) | Reused and extended by the agent URL guard (schemes, private networks, domains). |
| App allowlist (`.exe`/`.lnk` only, scripts and installers rejected) | `backend/app/desktop/actions.py` (`validate_app_path`, `AllowlistStore`) | Reused by the agent's Tier 2 `app.launch` action. |
| Desktop controller: disabled by default, random local token, 10 s approval TTL, rate limit, emergency-stop latch, Tier 3 refused before any OS call, DB + file audit | `backend/app/desktop/controller.py` | Not modified. Its invariants are repeated for the agent, which never enables desktop control itself. |
| Localhost-only desktop API and WebSocket | `backend/app/api/desktop.py` | Not modified. The agent adds a separate HTTP API. |
| Existing mouse/keyboard driver | `backend/app/desktop/system_driver.py`, `PyAutoGuiDriver` | The agent's `DesktopAdapter` only proxies through the existing controller when Desktop Control is already enabled and permitted. It is never used in the Milestone 1 browser demo. |

### 1.3 Permissions, modules and audit

| Piece | Location | Reuse |
| --- | --- | --- |
| Default-off per-module permission grants with denials written to audit | `backend/app/permissions/policy.py`, `backend/app/modules/permissions.py` | Not changed. The agent has its own enable switch (required by the spec) and additionally requires `device_control` for desktop Tier 2 work. |
| Module catalogue and statuses | `backend/app/modules/registry.py`, `backend/app/modules/service.py` | Not changed. |
| Append-only audit log with intent, event, action, target, risk, outcome, detail | `backend/app/db/database.py` (`audit_log`), `backend/app/db/store.py` (`append_audit`) | Reused for every agent plan, approval, action, result, block and injection warning. |
| Existing audit viewer | `/intents` engine `audit()`, `GET /audit`; System/Intent Map pages | New agent events are visible there. No passwords, page bodies or screenshots are written. |

### 1.4 AI provider adapter and online-provider confirmation

| Piece | Location | Reuse |
| --- | --- | --- |
| Vendor-neutral `AIProvider` protocol (`status`, `chat`) | `backend/app/ai/base.py` | Reused by the planner as-is. No new vendor and no key ever reaches the frontend. |
| Ollama local adapter | `backend/app/ai/ollama.py` | Reused for planning. If it is unavailable, the planner says so and the mock demo can use its honest deterministic demo plan. |
| Provider registry | `backend/app/ai/registry.py` | Reused. |
| Chat route | `backend/app/api/chat.py` | Not changed. |
| Existing remote-provider confirmation pattern | `backend/app/api/bci.py` (`/bci/provider/confirm`), `frontend/src/components/settings/MessageSettings.tsx` | Mirrored by the agent's per-task screenshot permission. Screenshots are never sent by default; enabling them requires naming the provider and confirming for that task. |

### 1.5 Voice, command bar, Mini Orb and Settings

| Piece | Location | Reuse |
| --- | --- | --- |
| Voice pipeline, wake prefix, push-to-talk, captions, clarification, TTS | `frontend/src/components/BozzVoiceProvider.tsx`, `frontend/src/services/speech.ts`, `frontend/src/services/tts.ts` | Extended with agent-only intents. All existing desktop/chat/BCI routes stay ahead of the agent route where they already match. |
| Command bar and orb | `frontend/src/components/hud/*`, `frontend/src/components/orb/*`, `frontend/src/home/*` | Unchanged. |
| Mini Orb main-window bridge | `frontend/src/components/mini/MiniOrbBridge.tsx` | The mini window uses the same voice provider, so “BOZZ, do …” and “BOZZ stop” reach the agent through the same path. State published to the mini window is not otherwise changed. |
| Settings page | `frontend/src/pages/SettingsPage.tsx`, `frontend/src/components/settings/*` | Additive agent section. Existing toggles are untouched. |
| History | `frontend/src/components/history/HistoryPanel.tsx`, `frontend/src/services/history.ts` | Agent tasks get their own stored history in the Agent panel; a compact agent entry is added to the shared History panel. |
| Reliability surface | `frontend/src/adaptive/report.ts` | The new `/reliability` page renders both the adaptive report and measured agent results. Unmeasured values stay “Not measured yet”. |

## 2. Gaps this milestone fills

1. There is no task planner, no plan preview for computer tasks, no execution loop, no step approvals and no four-level result model.
2. There is no isolated browser. Pixel mouse/keyboard control exists, but no DOM/accessibility adapter and no fresh browser profile.
3. There is no deterministic policy engine for model-proposed actions, no prompt-injection handling and no untrusted-data delimiter.
4. There is no domain allowlist for browsing, no private-network guard beyond basic URL normalisation and no test-only site.
5. There is no application capability registry and no rule that a profile becomes Verified only from recorded passing tests.
6. There is no Agent panel, persistent running banner or agent-specific voice grammar.
7. There are no agent tests or measured reliability results.

## 3. Files added or changed (planned and built in this milestone)

### Backend

Added:
- `config/computer_agent.json` — defaults, action catalogue, tier map, domain allowlist, limits.
- `config/agent_capabilities.json` — application capability profiles.
- `backend/app/agent/__init__.py`
- `backend/app/agent/schemas.py` — typed plan/step/action/result/state schemas and validation.
- `backend/app/agent/policy.py` — deterministic policy engine, URL guard, injection scanner, data-block wrapper.
- `backend/app/agent/planner.py` — strict-JSON planner + deterministic demo planner + scripted test planner.
- `backend/app/agent/adapters/__init__.py`
- `backend/app/agent/adapters/base.py` — `inspect/act/observe/verify` contract.
- `backend/app/agent/adapters/browser.py` — Playwright persistent-profile adapter.
- `backend/app/agent/adapters/official_api.py` — documented stub.
- `backend/app/agent/adapters/accessibility.py` — documented stub.
- `backend/app/agent/adapters/desktop.py` — proxy through the existing Desktop Control controller.
- `backend/app/agent/registry.py` — capability profile loader + test-result-driven status.
- `backend/app/agent/store.py` — agent task/step/test-result persistence.
- `backend/app/agent/service.py` — planning, approvals, execution loop, pause/cancel/stop, dry-run, reliability.
- `backend/app/agent/mock_site.py` — test-only mock site HTML and router.
- `backend/app/api/agent.py` — `/agent/*` routes.
- `backend/tests/__init__.py`
- `backend/tests/test_agent_policy.py`
- `backend/tests/test_agent_planner.py`
- `backend/tests/test_agent_executor.py`
- `backend/tests/test_agent_browser_live.py` (skips honestly when Playwright/Chromium is absent)

Changed:
- `backend/app/db/database.py` — additive agent tables (`agent_tasks`, `agent_steps`, `agent_test_results`), schema version 4.
- `backend/app/main.py` — mount mock-site router and agent router.
- `backend/requirements.txt` — add `playwright` for the opted-in browser adapter.

### Frontend

Added:
- `frontend/src/agent/types.ts`
- `frontend/src/agent/api.ts`
- `frontend/src/agent/state.ts` — pure state/label/format helpers used by tests.
- `frontend/src/agent/AgentProvider.tsx`
- `frontend/src/agent/AgentBanner.tsx`
- `frontend/src/agent/AgentPanel.tsx`
- `frontend/src/agent/AgentPlanView.tsx`
- `frontend/src/components/settings/AgentSettings.tsx`
- `frontend/src/pages/ReliabilityPage.tsx`
- `frontend/src/styles/agent.css`
- `frontend/src/agent/__tests__/agent.test.ts`

Changed:
- `frontend/src/App.tsx` — AgentProvider, banner, Agent slide-over, `/reliability` route.
- `frontend/src/home/panels.ts` — add the `agent` slide-over.
- `frontend/src/config/nav.ts` — Reliability entry.
- `frontend/src/pages/SettingsPage.tsx` — Agent settings section and live status.
- `frontend/src/components/BozzVoiceProvider.tsx` — agent intents (`do …`, `stop`, `approve`, `pause`).
- `frontend/src/components/history/HistoryPanel.tsx` — agent tasks in shared history.
- `frontend/src/services/history.ts` — agent history loader.
- `frontend/src/index.css` or the stylesheet import chain — import the agent styles.

### Documentation

- `docs/computer-agent.md`
- `docs/computer-agent-roadmap.md`
- `docs/PROJECT_STATUS.md` (milestone status row)

## 4. Safety invariants carried over unchanged

- Desktop Control stays off by default; its Tier 3 list, approval TTL and emergency-stop latch are untouched.
- BCI still has no send route.
- No new file delete/move/rename/write endpoint for holograms.
- API keys remain server-side; the agent status exposes only configured booleans and provider names.
- Module permission grants remain default-off.
- Existing voice, chat, history, orb, gesture and desktop flows keep their current priority.

## 5. Honest limitations of Milestone 1

- Windows UI Automation is a stub. Desktop applications are not automated by the agent in this milestone.
- Official APIs are a stub.
- The mock site is the only place where the full workflow, including a Tier 2 comment draft, is demonstrated.
- Real YouTube is read-only: search, open and read. Posting is Tier 3 and refused before any browser call.
- Screenshot-to-provider is off by default and requires a per-task confirmation naming the provider.
- Application profile status is computed from recorded test results. With no passing recorded suite a profile is `Experimental`, never `Verified`.
- Playwright/Chromium must be installed separately. Without it the browser adapter reports `available: false`; nothing pretends a browser exists.
