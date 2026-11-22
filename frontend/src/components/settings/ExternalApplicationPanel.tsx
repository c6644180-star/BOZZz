import { useCallback, useEffect, useState } from 'react'
import { desktopBridge } from '../../services/desktopBridge'
import type { ExternalDesktopWindow } from '../../types/desktop'

export function ExternalApplicationPanel() {
  const desktop = desktopBridge()
  const [windows, setWindows] = useState<ExternalDesktopWindow[]>([])
  const [status, setStatus] = useState('Supported application windows have not been checked.')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!desktop) return
    setBusy(true)
    try {
      const result = await desktop.listExternalWindows()
      setWindows(result.windows)
      setStatus(result.ok
        ? result.windows.length
          ? `Found ${result.windows.length} supported application window(s).`
          : 'No supported application windows were found.'
        : result.reason ?? 'External application discovery is unavailable.')
    } catch {
      setWindows([])
      setStatus('Could not inspect supported application windows.')
    } finally {
      setBusy(false)
    }
  }, [desktop])

  useEffect(() => { void refresh() }, [refresh])

  async function focusWindow(item: ExternalDesktopWindow) {
    if (!desktop || busy) return
    if (!window.confirm(`Bring ${item.appName} to the foreground? BOZZ will not read its title or contents.`)) return
    setBusy(true)
    try {
      const result = await desktop.focusExternalWindow(item.id)
      setStatus(result.ok ? `${result.appName ?? item.appName} focus requested.` : result.reason ?? 'Windows could not focus that application.')
      // The native token is one-use; obtain a fresh inventory after the action.
      const next = await desktop.listExternalWindows()
      setWindows(next.windows)
      if (!next.ok) setStatus(next.reason ?? 'Could not refresh the application inventory.')
    } catch {
      setStatus('Application focus failed. No automatic retry was attempted.')
      setWindows([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-module-permissions" aria-labelledby="external-app-title">
      <h3 id="external-app-title">External application intelligence</h3>
      <p>Identify and focus supported open apps. BOZZ reads app identity only—not window titles, browser tabs, document names, or app contents.</p>
      {!desktop ? <p role="status">Available only in the installed BOZZ desktop app on Windows.</p> : (
        <>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Working…' : 'Scan supported apps'}
          </button>
          <ul>
            {windows.map((item) => (
              <li key={item.id}>
                <strong>{item.appName}</strong>
                <button type="button" className="secondary-action" disabled={busy} onClick={() => void focusWindow(item)}>
                  Focus app
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" aria-live="polite">{status}</p>
      <small>Supported apps: Notepad, Paint, Calculator, Microsoft Edge, Google Chrome, and Visual Studio Code. Focus requires confirmation and may be restricted by Windows.</small>
    </section>
  )
}
