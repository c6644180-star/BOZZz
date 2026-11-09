import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadSettings } from './services/localStore'

const bootSettings = loadSettings()
if (window.location.pathname === '/mini') document.documentElement.dataset.surface = 'mini'
document.documentElement.dataset.theme = bootSettings.orbTheme
document.documentElement.dataset.motion = bootSettings.reduceMotion ? 'reduced' : 'full'
document.documentElement.dataset.effects = bootSettings.backgroundEffects ? 'on' : 'off'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
