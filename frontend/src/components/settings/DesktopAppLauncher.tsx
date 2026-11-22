import { useState } from 'react'
import { desktopBridge } from '../services/desktopBridge'
import type { DesktopAppId } from '../types/desktop'

const APPS: { id: DesktopAppId; label: string; detail: string }[] = [
  { id: 'calculator', label: 'Calculator', detail: 'Windows Calculator' },
  { id: 'notepad', label: 'Notepad', detail: 'Windows Notepad' },
  { id: 'paint', label: 'Paint', detail: 'Windows Paint' },
]

export function DesktopAppLauncher() {
  const desktop = desktopBridge()
  const [busy, setBusy] = useState<DesktopAppId | null>(null)
  const [status, setStatus] = useState('Choose an app. BOZZ will ask before opening it.')

  async function launch(id: DesktopAppId, label: string) {
    if (!desktop || busy) return
    if (!window.confirm(`Allow BOZZ to open ${label}?`)) return
    setBusy(id)
    setStatus(`Requesting Windows to open ${label}…`)
    try {
      const result = await desktop.launchApp(id)
      setStatus(result.ok ? `${label} launch request sent to Windows.` : result.reason ?? 'Windows could not open the app.')
    } catch {
      setStatus('The desktop launch request failed. No retry was performed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-module-permissions" aria-labelledby="desktop-app-launcher-title">
      <h3 id="desktop-app-launcher-title">Desktop app launcher</h3>
      <p>Open a small set of approved Windows apps. Each launch requires your confirmation.</p>
      {!desktop ? <p role="status">Available only in the installed BOZZ desktop app on Windows.</p> : null}
      <div className="desktop-app-launcher__actions">
        {APPS.map((app) => (
          <button key={app.id} type="button" className="secondary-action" disabled={!desktop || busy !== null} onClick={() => void launch(app.id, app.label)}>
            {busy === app.id ? `Opening ${app.label}…` : `Open ${app.label}`}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite">{status}</p>
      <small>BOZZ cannot launch arbitrary commands or applications from chat in this milestone.</small>
    </section>
  )
}
