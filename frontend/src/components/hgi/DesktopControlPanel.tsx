import { useEffect } from 'react'
import { MonitorCog, OctagonAlert, Power, ShieldAlert } from 'lucide-react'
import { useHgi } from './hgiContext'

// Compact Gesture Lab summary. The full controls live in the Desktop Control
// slide-over so the page does not become a permanent control sidebar.
export function DesktopControlPanel() {
  const {
    desktopStatus,
    desktopEnabled,
    desktopBusy,
    desktopConnection,
    desktopDetail,
    desktopLoadError,
    desktopState,
    desktopApprovals,
    desktopPermissionGranted,
    enableDesktop,
    disableDesktop,
    emergencyStop,
    refreshDesktop,
  } = useHgi()

  useEffect(() => {
    void refreshDesktop()
  }, [refreshDesktop])

  const available = desktopStatus?.available ?? false
  const status = desktopLoadError
    ? desktopLoadError
    : desktopStatus
      ? desktopStatus.available
        ? 'Backend driver ready'
        : desktopStatus.detail ?? 'Backend cannot drive a mouse'
      : 'Checking backend…'

  return (
    <div className="hgi-card hgi-desktop-panel">
      <div className="hgi-card__head">
        <h3><MonitorCog /> Desktop control</h3>
        <span className={`hgi-chip ${desktopEnabled ? 'is-live is-danger' : ''}`}>{desktopState.toUpperCase()}</span>
      </div>
      <p>
        Hands can move the real Windows pointer, click, drag, scroll, use media keys and approved shortcuts. Tier 2
        actions need on-screen approval; shell, file changes and system actions are blocked.
      </p>

      <dl className="hgi-diagnostics">
        <div><dt>Backend</dt><dd>{status}</dd></div>
        <div><dt>Permission</dt><dd>{desktopPermissionGranted ? 'device control granted' : 'NOT granted — control stays off'}</dd></div>
        <div><dt>Socket</dt><dd>{desktopConnection}{desktopDetail ? <small>{desktopDetail}</small> : null}</dd></div>
        <div><dt>Pending approvals</dt><dd>{desktopApprovals.length}</dd></div>
        <div><dt>Emergency stop</dt><dd>{desktopStatus?.emergency_stopped ? 'LATCHED — restart backend' : 'ready'}</dd></div>
      </dl>

      <div className="hgi-card__actions">
        {!desktopEnabled ? (
          <button
            type="button"
            className="hgi-btn hgi-btn--accent"
            onClick={() => void enableDesktop()}
            disabled={desktopBusy || !available || !desktopPermissionGranted}
          >
            <Power /> {desktopBusy ? 'Enabling…' : 'Turn desktop control on'}
          </button>
        ) : (
          <button type="button" className="hgi-btn" onClick={() => void disableDesktop()}>
            Turn desktop control off
          </button>
        )}
        <button type="button" className="hgi-btn hgi-btn--danger" onClick={() => void emergencyStop()}>
          <OctagonAlert /> Emergency Stop
        </button>
        <button
          type="button"
          className="hgi-btn"
          onClick={() => window.dispatchEvent(new Event('bozz:open-desktop'))}
        >
          Open full panel
        </button>
      </div>

      {desktopApprovals.length > 0 && (
        <p className="hgi-card__note" role="status">
          {desktopApprovals.length} Tier 2 action{desktopApprovals.length === 1 ? '' : 's'} waiting for approval.
        </p>
      )}
      {!desktopPermissionGranted && (
        <p className="hgi-card__note">
          <ShieldAlert /> Grant HGI device control in the full panel or Settings before turning this on.
        </p>
      )}
      <p className="hgi-card__note">
        Safe first test: open Notepad, keep one hand relaxed in view, and pinch over empty space. Ctrl+Alt+Q or the
        Emergency Stop button stops immediately.
      </p>
    </div>
  )
}
