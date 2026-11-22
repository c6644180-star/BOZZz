import { useCallback, useEffect, useState } from 'react'
import { desktopBridge } from '../services/desktopBridge'
import type { ManagedDesktopWindow } from '../types/desktop'

export function ManagedWindowPanel() {
  const desktop = desktopBridge()
  const [windows, setWindows] = useState<ManagedDesktopWindow[]>([])
  const [status, setStatus] = useState('Window inventory has not been loaded.')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!desktop) return
    setBusy(true)
    try {
      const result = await desktop.listManagedWindows()
      setWindows(result)
      setStatus(result.length ? `Found ${result.length} BOZZ-managed window(s).` : 'No BOZZ-managed windows are currently available.')
    } catch {
      setStatus('Could not read BOZZ window inventory.')
    } finally {
      setBusy(false)
    }
  }, [desktop])

  useEffect(() => { void refresh() }, [refresh])

  async function focusWindow(win: ManagedDesktopWindow) {
    if (!desktop || busy) return
    if (!window.confirm(`Bring ${win.title} to the foreground?`)) return
    setBusy(true)
    try {
      const result = await desktop.focusManagedWindow(win.id)
      setStatus(result.ok ? `${win.title} was focused.` : result.reason ?? 'Could not focus that window.')
      await refresh()
    } catch {
      setStatus('Window focus failed. No repeated action was attempted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-module-permissions" aria-labelledby="managed-window-title">
      <h3 id="managed-window-title">BOZZ window intelligence</h3>
      <p>View and focus BOZZ-owned windows only. Other applications and their contents are not inspected.</p>
      {!desktop ? <p role="status">Available only in the installed BOZZ desktop app.</p> : (
        <>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void refresh()}>{busy ? 'Working…' : 'Refresh windows'}</button>
          <ul>
            {windows.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong> · {item.visible ? 'visible' : 'hidden'} · {item.focused ? 'focused' : 'not focused'} · {item.minimized ? 'minimized' : 'not minimized'}
                <button type="button" className="secondary-action" disabled={busy} onClick={() => void focusWindow(item)}>Focus</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" aria-live="polite">{status}</p>
    </section>
  )
}
