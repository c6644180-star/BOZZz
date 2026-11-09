# BOZZ Modules

This page describes how modules are registered, gated and reported. It reflects
the code in `backend/app/modules/`, `backend/app/api/modules.py` and
`frontend/src/services/modules.ts`.

## Module registry

Every module has:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier used by permissions, the API and the UI |
| `name`, `version` | Display name and version |
| `status` | `Ready`, `Simulation`, `Not connected` or `Error` |
| `description`, `status_detail` | What is real today and what is not |
| `route` | The page that owns it, or `null` |
| `capabilities` | Honest list of working slices |
| `permissions` | Permission IDs the backend enforces for it |

The backend registry is authoritative. The frontend keeps an offline copy so the
menu and module pages render when the backend is unreachable; that copy is
replaced as soon as `GET /api/modules` succeeds.

## Current modules

| Module | Status | Permission | Notes |
| --- | --- | --- | --- |
| Voice | Ready | microphone, network | Browser speech input; ElevenLabs server-side speech with browser fallback |
| Intent Map | Ready | file_access | Six-stage workflow with approval and real verification evidence |
| HGI | Ready | camera, device_control | Local MediaPipe gesture pipeline plus Desktop Control v2 (three-tier allowlist, voice and gesture input); camera is released until Gesture Lab starts |
| Spatial Desktop | Ready | file_access | Read-only cards over allowed folders; no write/delete endpoints |
| Holographic Projects | Ready | file_access | Read-only 3D folder tree and glTF part viewer over allowed folders; shares the Spatial Desktop file grant |
| L3DME | Ready | — | Local GLB/glTF viewer; model bytes never reach the backend |
| BCI | Ready | message_data | Local conversation store, summaries, drafts, translation; no send path |
| BCCI | Not connected | microphone, messaging, network | `/calls` only simulates a call notification |
| DEI | Not connected | device_control, network | `/devices-hub` is a shell; `/devices` (ADB) belongs to the separate jarvis-main project |
| Memory | Ready | — | Browser-local notes only |

Modules that are not connected must say **Not connected** in the UI. Simulated
output must be labelled **Simulation**. There are no fake metrics.

## Permissions

Permissions are off by default and stored locally. The backend enforces these
pairs:

| Module | Permission |
| --- | --- |
| Intent Map | `file_access` |
| Spatial Desktop | `file_access` |
| Holographic Projects | `file_access` (the same OS-folder grant as Spatial Desktop) |
| BCI | `message_data` |

Grant and revoke from **Settings → Module permissions**, or from the module's own
settings section. Every change is audited (`permission_grant` / `permission_revoke`).

The backend checks the permission on every consequential request; hiding a
button in the frontend is not the security boundary.

## Holographic Projects

`/projects` opens a read-only 3D scene of the folders you allow, plus a
holographic viewer for `.glb` / `.gltf` files. It is a **3D scene drawn on the
monitor, not a real hologram**. Removing or hiding a node never deletes a file;
the scene only renders entries returned by the file API.

### Tree scene

- Root node in the centre, children on radial rings, thin glowing links.
- Single click/tap on a folder expands or collapses it. Double click/tap opens
  it as the new root (breadcrumb tracks the real path). `Esc` goes up one level.
- Images, text, Markdown and PDFs open a floating preview. A `.glb`/`.gltf`
  opens the model viewer. Other openable files use the existing Intent Map open
  approval and show "This opens in another app" first. Executables and scripts
  are shown but never opened.
- Drag orbits, wheel zooms, right-drag pans, `R` and the reset button restore the
  camera.
- Children load lazily. Each expanded folder shows at most 60 entries with a
  `+N more` node, and the scene shows at most 300 nodes in total.
- Image filter, quality (Low / Medium / High) and named view layouts are in the
  toolbar. A layout is JSON only: `{ root, expanded[], filterImages, camera }`.

### Gestures

Gestures reuse the single HGI event bus; the hologram does not open a camera or
run its own hand tracking. They work only while Gesture Lab is running and only
above the minimum confidence from HGI settings. Mouse and touch always work.

| HGI event | Hologram action |
| --- | --- |
| `gesture.move` | Point ray highlights the node under the hand; pinch-hold + move orbits the tree |
| `gesture.pinch_start` / `pinch_hold` | Starts a press; hold longer than 350 ms is a drag, not a tap |
| `gesture.pinch_end` | Quick pinch (≤ 350 ms) is a tap; two taps on one node within 600 ms are a double tap |
| `gesture.zoom` | Two-hand spread/close zooms the tree camera (and drives the exploded view in the model viewer) |
| `gesture.rotate` | Wrist rotation orbits the scene |
| `gesture.recognized` (`wrist_rotation`) | Enables short wrist-driven orbit |

Taps share one timing rule (`frontend/src/holo/taps.ts`): 350 ms maximum press,
600 ms double window, 250 ms cooldown. The first tap is only emitted when the
double window closes, so a double tap never expands a folder first. The status
chip shows the current gesture and the node under the pointer.

### Model viewer

The viewer loads real glTF geometry through the read-only file API and keeps the
typed control API (`rotate`, `zoom`, `setMode`, `selectPart`, `explode`,
`reset`) so mouse, voice and gestures call the same functions.

- Visual modes: Solid, Hologram (fresnel + edges), Wireframe, Transparent.
- Explode: stores each part's original transform and moves it outward from the
  model centre. The slider, a two-hand spread or "separate the components"
  drives it; 0 and "reassemble" restore the exact original transforms.
- Part panel shows the real mesh/node name, type, bounding size and triangle
  count from the file. No invented descriptions.
- Hide part / isolate part / show all are view-only; the file is never written.
- Pixel ratio is capped at 1.5, labels are limited, rendering pauses when the
  tab is hidden, and geometries/materials/textures are disposed on close.

### Voice commands

| Command | Action |
| --- | --- |
| `show holographic projects` | Opens `/projects` |
| `open my <name> folder` | Intent Map search **inside allowed folders only**; several matches → pick one, none → says so |
| `expand <name>` / `collapse [name]` | Expands/collapses a node |
| `open <name>` | Opens a node (preview, model or approved OS open) |
| `go back` / `reset view` | Up one level / reset the camera |
| `show only images` / `show all files` | Image filter on/off |
| `zoom in` / `zoom out` | Camera zoom |
| `hide part <name>`, `isolate part <name>`, `show all parts`, `hologram mode` | Model viewer, when a model is open |

Folder searches and opens are written to the audit/history trail. Nothing is
sent anywhere; the backend has no write, move, rename, delete or upload endpoint
for files.

## Intent Map

Consequential actions run as Intent Map tasks with the stages:

`UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT`

A task may only be reported as done when it has real verification evidence. BCI
summaries and drafts record `model_response` evidence: what the provider
returned, what was stored, and that nothing was sent. BCI unanswered-question
and attention actions never call the provider; they record `local_rules`
evidence and quote the stored messages.

Open `/intent-map` to inspect tasks, or `/intent-map?intent=<id>` to jump to a
specific task.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/modules` | Registry snapshot with effective permission state |
| POST | `/api/modules/{module}/permissions` | Grant or revoke `{ permission, granted }` |
| GET | `/api/audit` | Append-only audit entries |

## Adding a module

1. Add a `ModuleDefinition` in `backend/app/modules/registry.py` with an honest
   status and only the permissions the backend enforces.
2. Enforce the permission in the module's routes.
3. Mirror the definition in `frontend/src/services/modules.ts` for offline
   rendering.
4. Add the route and the menu entry in `frontend/src/config/nav.ts` and
   `frontend/src/App.tsx`.
5. Add tests for permission denial and for the module's core behaviour.
6. Document what is real, what is simulated and what is not connected.

## Beginner checks

From the repository root:

```bash
# Backend
PYTHONPATH=backend ./.venv/Scripts/python.exe -m unittest discover -s tests/backend -t tests/backend -q

# Frontend
cd frontend
npm test
npm run lint
npm run build
npm run dev
```

Then open `http://127.0.0.1:5173/modules`. A green/ready module has a real
working slice; a “Not connected” module is intentionally inert.
