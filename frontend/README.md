# BOZZ Frontend

React 19 + TypeScript + Vite renderer for BOZZ. It provides the command center, chat, and the live Intent Map workflow console. All AI and file actions are performed by the local FastAPI backend; the renderer never executes filesystem or system actions itself.

## Run

```powershell
npm install
npm run dev
```

Open the Vite address (normally `http://localhost:5173`). Start the backend at `http://localhost:8000` first. Vite proxies `/api/*` to the backend and strips the `/api` prefix.

## Verify

```powershell
npm run lint
npm run build
npm run preview
```

## Structure

```text
src/
  App.tsx                       shell, routing, providers, command dock
  components/orb/               lazy-loaded Three.js orb (separate chunk)
  components/BozzVoiceProvider.tsx  chat state, speech, backend calls
  pages/IntentMapPage.tsx       propose → approve → execute → verify → report
  services/backend.ts           health and chat API
  services/intent.ts            typed intent/audit/workspace API
  services/localStore.ts        localStorage for non-sensitive UI data
  services/speech.ts            Web Speech capability wrapper
  services/motionGesture.ts     camera pixel-motion signal
  config/nav.ts                 navigation registry; unavailable modules labeled
  styles/                       layout and module styles
electron/main.cjs               hardened dev shell; not packaged yet
```

## Backend dependency

The Intent Map page needs the local backend. Without it, the page shows an offline state and does not pretend to be connected. Chat additionally needs a running Ollama instance with the configured model.

## Status

Working: routing, command center, chat surface, Intent Map workflow, browser-local UI data, 3D orb.

Preview/locked: Voice Studio, Spatial Desktop, Desktop Control, Spatial Intelligence, 3D Engineering Studio, Health, Market Analyzer, System Diagnostics. Items marked `available: false` in `src/config/nav.ts` are intentionally not implemented.

Known issues: two navigation entries share `/vision`; there is no React error boundary; Electron has no packaging pipeline.

See the repository root [README.md](../README.md) and [docs/PROJECT_STATUS.md](../docs/PROJECT_STATUS.md) for the verified overall state.
