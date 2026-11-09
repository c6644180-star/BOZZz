# Third-party notices

BOZZ bundles or depends on the following third-party components. Licenses are
the upstream licenses; this file is a summary, not legal advice.

## Frontend

| Component | Version | License | Use |
| --- | --- | --- | --- |
| `@mediapipe/tasks-vision` | 1.2.2 | Apache License 2.0 | Hand landmark inference in the browser |
| MediaPipe hand landmark model (`hand_landmarker.task`) | upstream task bundle | Apache License 2.0 | Model weights served from `frontend/public/mediapipe/` |
| React / React DOM | 19.x | MIT | UI runtime |
| react-router-dom | 7.x | MIT | Routing |
| lucide-react | 1.66.x | ISC | Icons |
| Three.js (lazy orb scene) | per `package.json` | MIT | Orb rendering |
| ultron-by-sagar-builds-main (`lib/orbScene.ts`) | upstream snapshot | MIT, Copyright (c) 2026 Sagar Tamang | Base for `frontend/src/components/orb/orbScene.ts` |
| Vite / Vitest / TypeScript | per `package.json` | MIT / Apache-2.0 | Build and tests |
| Rajdhani (500 / 600 woff2) | static subset | SIL Open Font License 1.1 | Display font for the BOZZ wordmark; self-hosted in `frontend/src/assets/fonts/` (no CDN) |

The orb adaptation is the only copied source. Full copyright and licence text
for that work, Three.js and the Rajdhani font are in
[THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).

MediaPipe wasm and the `.task` model are copied into the repository so the app
does not fetch them from a CDN at runtime. See `frontend/public/mediapipe/`.

## Backend

| Component | Version | License | Use |
| --- | --- | --- | --- |
| FastAPI | 0.162.0 | MIT | HTTP/WebSocket API |
| Uvicorn | 0.54.0 | BSD-3-Clause | ASGI server |
| pydantic | via FastAPI | MIT | Request schemas |
| pyautogui | 0.9.54 | BSD-3-Clause | Mouse move/click/drag/scroll |
| pynput | 1.8.1 | LGPL-3.0 | `Ctrl+Alt+Q` global emergency hotkey |

`pyautogui` and `pynput` are used only by the optional desktop-control adapter.
If either package is unavailable, the adapter reports that desktop control is
unavailable and the rest of BOZZ keeps working.

ElevenLabs text-to-speech is an opt-in network service configured by the user;
no ElevenLabs client library is bundled. Audio is requested by the backend and
never proxies the API key to the frontend.
