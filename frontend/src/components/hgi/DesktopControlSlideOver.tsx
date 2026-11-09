import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppWindow, Keyboard, Mic, MonitorCog, OctagonAlert, Play, Power, ShieldAlert, ShieldCheck, Square, Trash2, Volume2 } from 'lucide-react'
import { useHgi } from './hgiContext'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import type { DesktopActionRecord, PendingApproval } from '../../hgi/desktop/desktopSocket'

const TIER_COPY: Record<number, string> = {
  1: 'Tier 1 — runs immediately',
  2: 'Tier 2 — on-screen approval every time',
  3: 'Tier 3 — blocked, no override',
}

const STATUS_COPY: Record<DesktopActionRecord['status'], string> = {
  verified: 'done · verified',
  executed: 'executed · not verified',
  rejected: 'rejected',
  blocked: 'blocked',
  failed: 'failed',
}

function secondsLeft(expiresInMs: number): string {
  return `${Math.max(0, Math.ceil(expiresInMs / 1000))} s`
}

function ApprovalRow({ approval, onResolve }: { approval: PendingApproval; onResolve: (approve: boolean) => void }) {
  const [startedAt] = useState(() => performance.now())
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  const remaining = Math.max(0, approval.expires_in_ms - (now - startedAt))
  return (
    <li className="desktop-approval-row">
      <div>
        <strong>{approval.label}</strong>
        <small>
          {TIER_COPY[approval.tier] ?? `Tier ${approval.tier}`} · {approval.source} · target: {approval.target ?? '—'} ·{' '}
          {remaining > 0 ? `${secondsLeft(remaining)} left` : 'expired'}
        </small>
      </div>
      <div className="desktop-approval-row__actions">
        <button type="button" className="hgi-btn hgi-btn--accent" onClick={() => onResolve(true)} disabled={remaining <= 0}>
          <ShieldCheck /> Approve
        </button>
        <button type="button" className="hgi-btn" onClick={() => onResolve(false)}>
          Deny
        </button>
      </div>
    </li>
  )
}

export function DesktopControlSlideOver() {
  const hgi = useHgi()
  const { mic, toggleListening } = useBozzVoice()
  const {
    desktopStatus,
    desktopAllowlist,
    desktopApprovals,
    desktopActions,
    desktopDictation,
    desktopEnabled,
    desktopBusy,
    desktopConnection,
    desktopDetail,
    desktopLoadError,
    desktopState,
    desktopPermissionGranted,
    desktopPermissionBusy,
    settings,
    updateSettings,
    enableDesktop,
    disableDesktop,
    emergencyStop,
    refreshDesktop,
    refreshDesktopAllowlist,
    grantDesktopPermission,
    approveDesktop,
    runDesktopAction,
    startDesktopDictation,
    stopDesktopDictation,
    saveDesktopApp,
    deleteDesktopApp,
    saveDesktopUrl,
    deleteDesktopUrl,
    saveDesktopShortcuts,
  } = hgi

  const [appLabel, setAppLabel] = useState('')
  const [appPath, setAppPath] = useState('')
  const [urlLabel, setUrlLabel] = useState('')
  const [urlUrl, setUrlUrl] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  useEffect(() => {
    void refreshDesktop()
    void refreshDesktopAllowlist()
  }, [refreshDesktop, refreshDesktopAllowlist])

  const capabilities = desktopStatus?.capabilities
  const tierGroups = useMemo(() => {
    const actions = desktopAllowlist?.actions ?? []
    return {
      tier1: actions.filter((action) => action.tier === 1).length,
      tier2: actions.filter((action) => action.tier === 2).length,
      tier3: actions.filter((action) => action.tier === 3).length,
    }
  }, [desktopAllowlist])

  const shortcuts = desktopAllowlist?.allowlist.shortcuts ?? []
  const enabledShortcuts = shortcuts.filter((item) => item.enabled).map((item) => item.id)

  async function withBusy(key: string, task: () => Promise<unknown>) {
    setBusyAction(key)
    try {
      await task()
    } finally {
      setBusyAction(null)
    }
  }

  function toggleShortcut(id: string) {
    const next = enabledShortcuts.includes(id)
      ? enabledShortcuts.filter((item) => item !== id)
      : [...enabledShortcuts, id]
    void withBusy(`shortcut:${id}`, () => saveDesktopShortcuts(next))
  }

  return (
    <div className="desktop-panel">
      <div className="desktop-panel__top">
        <div className={`desktop-state-chip is-${desktopState.toLowerCase().replace(/\s+/g, '-')}`} role="status">
          {desktopState}
        </div>
        <div className="desktop-panel__top-actions">
          {!desktopEnabled ? (
            <button
              type="button"
              className="hgi-btn hgi-btn--accent"
              onClick={() => void enableDesktop()}
              disabled={desktopBusy || !desktopStatus?.available || !desktopPermissionGranted}
            >
              <Power /> {desktopBusy ? 'Turning on…' : 'Turn on'}
            </button>
          ) : (
            <button type="button" className="hgi-btn" onClick={() => void disableDesktop()}>
              Turn off
            </button>
          )}
          <button type="button" className="hgi-btn hgi-btn--danger" onClick={() => void emergencyStop()}>
            <OctagonAlert /> Emergency Stop
          </button>
        </div>
      </div>

      <p className="desktop-panel__lede">
        Hands-free PC control on this machine only. Tier 1 mouse, media and window actions run immediately; Tier 2 app,
        website, shortcut and dictation actions need your approval each time; Tier 3 actions are always blocked.
      </p>

      {desktopLoadError && <p className="desktop-panel__warn" role="alert">{desktopLoadError}</p>}
      {desktopDetail && !desktopLoadError && <p className="desktop-panel__note">{desktopDetail}</p>}
      {desktopStatus?.emergency_stopped && (
        <p className="desktop-panel__warn" role="alert">
          Emergency stop is latched. Nothing else will run until you restart the local backend and check the pointer and
          control area.
        </p>
      )}

      <section className={`desktop-permission ${desktopPermissionGranted ? 'is-granted' : ''}`}>
        <div>
          <h3><ShieldAlert /> Device-control permission</h3>
          <p>
            {desktopPermissionGranted
              ? desktopEnabled
                ? 'Granted for the HGI module. Desktop control is ON — turn it off or press Emergency Stop at any time.'
                : 'Granted for the HGI module. Desktop control is still OFF until you turn it on.'
              : 'OFF. The backend refuses every desktop action until this permission is granted.'}
          </p>
        </div>
        {!desktopPermissionGranted && (
          <button
            type="button"
            className="hgi-btn"
            onClick={() => void grantDesktopPermission()}
            disabled={desktopPermissionBusy}
          >
            {desktopPermissionBusy ? 'Granting…' : 'Grant device control'}
          </button>
        )}
      </section>

      <section className="desktop-panel__section">
        <h3><MonitorCog /> Live state</h3>
        <dl className="hgi-diagnostics">
          <div><dt>Backend</dt><dd>{desktopStatus ? (desktopStatus.available ? 'driver ready' : 'no desktop driver') : 'unreachable'}</dd></div>
          <div><dt>Bridge socket</dt><dd>{desktopConnection}{desktopStatus?.bridge ? ` · ${desktopStatus.bridge.connections} connection${desktopStatus.bridge.connections === 1 ? '' : 's'}` : ''}</dd></div>
          <div><dt>pyautogui / pynput</dt><dd>{desktopStatus ? `${desktopStatus.pyautogui ? 'loaded' : 'missing'} / ${desktopStatus.pynput ? 'loaded' : 'missing'}` : '—'}</dd></div>
          <div><dt>Global hotkey</dt><dd>{desktopStatus ? (desktopStatus.hotkey ? 'Ctrl+Alt+Q registered' : 'not registered') : '—'}</dd></div>
          <div><dt>Real screen</dt><dd>{desktopStatus?.screen ? `${desktopStatus.screen.width}×${desktopStatus.screen.height}` : '—'}</dd></div>
          <div><dt>Confidence gate</dt><dd>{desktopStatus ? `${Math.round(desktopStatus.min_confidence * 100)}%` : '—'}</dd></div>
          <div><dt>Rate limit</dt><dd>{desktopStatus ? `${desktopStatus.rate_limit} / s` : '—'}</dd></div>
          <div><dt>Idle auto-off</dt><dd>{desktopStatus ? `${desktopStatus.idle_seconds} s without input` : '—'}</dd></div>
          <div><dt>Microphone</dt><dd>{mic.listening ? 'listening' : mic.available ? 'ready, not listening' : 'unavailable'}</dd></div>
        </dl>
        <div className="desktop-capabilities">
          {[
            ['Mouse', capabilities?.mouse],
            ['Keyboard', capabilities?.keyboard],
            ['Volume', capabilities?.volume],
            ['Media keys', capabilities?.media],
            ['Brightness', capabilities?.brightness],
            ['Window', capabilities?.window],
            ['Screenshot', capabilities?.screenshot],
            ['App launch', capabilities?.app_launch],
          ].map(([label, ok]) => (
            <span key={String(label)} className={ok ? 'is-ok' : 'is-missing'}>
              {String(label)}: {ok ? 'available' : 'not available'}
            </span>
          ))}
        </div>
        <p className="hgi-card__note">
          A missing capability stays missing — BOZZ does not pretend an action worked. Brightness and volume need the
          matching Windows interfaces on this machine.
        </p>
      </section>

      <section className="desktop-panel__section">
        <div className="desktop-section-head">
          <h3><ShieldCheck /> Pending approvals</h3>
          <span className="hgi-chip">{desktopApprovals.length}</span>
        </div>
        {desktopApprovals.length === 0 ? (
          <p className="hgi-card__note">No Tier 2 action is waiting. Approvals expire after 10 seconds.</p>
        ) : (
          <ul className="desktop-approval-list">
            {desktopApprovals.map((approval) => (
              <ApprovalRow
                key={approval.approval_id}
                approval={approval}
                onResolve={(approve) => void approveDesktop(approval.approval_id, approve, 'ui')}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="desktop-panel__section">
        <div className="desktop-section-head">
          <h3><Square /> Dictation</h3>
          <span className={`hgi-chip ${desktopDictation?.active ? 'is-live' : ''}`}>
            {desktopDictation?.active ? 'ON' : 'OFF'}
          </span>
        </div>
        <p className="desktop-panel__warn">
          Never dictate passwords, card numbers, or private data. Text is typed into whichever window has focus and is
          not stored by BOZZ.
        </p>
        <p className="hgi-card__note">
          {desktopDictation?.active
            ? `${desktopDictation.remaining_chars} of ${desktopDictation.max_chars} characters left · max ${desktopDictation.max_chars_per_utterance} per utterance · stops after silence.`
            : desktopDictation
              ? `Dictation is off. Budget: ${desktopDictation.max_chars} characters per session, ${desktopDictation.max_chars_per_utterance} per utterance. Starting it needs Tier 2 approval and a visible dictation banner.`
              : 'Dictation is off. Starting it needs Tier 2 approval and a visible dictation banner.'}
        </p>
        <div className="hgi-card__actions">
          {!desktopDictation?.active ? (
            <button
              type="button"
              className="hgi-btn hgi-btn--accent"
              onClick={() => void withBusy('dictation:start', () => startDesktopDictation())}
              disabled={!desktopEnabled || busyAction === 'dictation:start'}
            >
              <Mic /> Start dictation
            </button>
          ) : (
            <button type="button" className="hgi-btn hgi-btn--danger" onClick={() => void stopDesktopDictation()}>
              <Square /> Stop dictation
            </button>
          )}
          <button type="button" className="hgi-btn" onClick={toggleListening}>
            <Mic /> {mic.listening ? 'Mic off' : 'Mic on'}
          </button>
        </div>
      </section>

      <section className="desktop-panel__section">
        <div className="desktop-section-head">
          <h3><Play /> Recent actions</h3>
          <span className="hgi-chip">{desktopActions.length}</span>
        </div>
        {desktopActions.length === 0 ? (
          <p className="hgi-card__note">Nothing has run yet. The backend records the last 10 actions.</p>
        ) : (
          <ul className="desktop-action-list">
            {desktopActions.slice(0, 10).map((action, index) => (
              <li key={`${action.at ?? ''}-${action.action_id}-${index}`} className={`is-${action.status}`}>
                <div>
                  <strong>{action.label}</strong>
                  <small>
                    {action.action_id} · Tier {action.tier ?? '?'} · {action.source} · {STATUS_COPY[action.status]}
                  </small>
                  {action.detail && <small>{action.detail}</small>}
                </div>
                {action.at && <time>{new Date(action.at).toLocaleTimeString()}</time>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="desktop-panel__section">
        <h3><Keyboard /> Control area and feel</h3>
        <div className="hgi-settings-grid">
          <label className="hgi-field">
            <span>Active area <small>{Math.round(settings.desktop.area * 100)}% of the screen</small></span>
            <input
              type="range" min={0.3} max={1} step={0.01}
              value={settings.desktop.area}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, area: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Horizontal position <small>{settings.desktop.positionX.toFixed(2)} screen widths</small></span>
            <input
              type="range" min={-0.5} max={0.5} step={0.01}
              value={settings.desktop.positionX}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, positionX: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Vertical position <small>{settings.desktop.positionY.toFixed(2)} screen heights</small></span>
            <input
              type="range" min={-0.5} max={0.5} step={0.01}
              value={settings.desktop.positionY}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, positionY: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Sensitivity <small>{settings.desktop.sensitivity.toFixed(2)}×</small></span>
            <input
              type="range" min={0.3} max={2.5} step={0.05}
              value={settings.desktop.sensitivity}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, sensitivity: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Smoothing <small>{Math.round(settings.desktop.smoothing * 100)}%</small></span>
            <input
              type="range" min={0} max={0.9} step={0.01}
              value={settings.desktop.smoothing}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, smoothing: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Click delay <small>{settings.desktop.clickDelayMs} ms</small></span>
            <input
              type="range" min={0} max={500} step={10}
              value={settings.desktop.clickDelayMs}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, clickDelayMs: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Edge margin <small>{settings.desktop.edgeMargin} px inside each edge</small></span>
            <input
              type="range" min={0} max={100} step={1}
              value={settings.desktop.edgeMargin}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, edgeMargin: Number(event.target.value) } })}
            />
          </label>
          <label className="hgi-field">
            <span>Idle auto-off <small>{settings.desktop.idleSeconds} s without input</small></span>
            <input
              type="range" min={10} max={3600} step={10}
              value={settings.desktop.idleSeconds}
              onChange={(event) => updateSettings({ desktop: { ...settings.desktop, idleSeconds: Number(event.target.value) } })}
            />
          </label>
        </div>
        <div className="desktop-test-checklist">
          <h4>Test in Notepad, in order</h4>
          <ol>
            <li>Open Notepad with an empty document.</li>
            <li>Turn gestures on, then Desktop mode, then Desktop control.</li>
            <li>Point to move the real pointer over empty Notepad space.</li>
            <li>Pinch once to click. Try a slow pinch-hold to drag a selection.</li>
            <li>Two fingers up or down scrolls. Flick left or right switches windows.</li>
            <li>Press the Emergency Stop button and confirm the red banner disappears.</li>
          </ol>
          <div className="hgi-card__actions">
            <button
              type="button"
              className="hgi-btn"
              onClick={() => void withBusy('launch:notepad', () => runDesktopAction('app.launch', { name: 'Notepad' }))}
              disabled={!desktopEnabled || busyAction === 'launch:notepad'}
            >
              <AppWindow /> {busyAction === 'launch:notepad' ? 'Requesting…' : 'Request Notepad (Tier 2)'}
            </button>
            <Link className="hgi-btn hgi-btn--accent" to="/gesture">Gesture Lab</Link>
          </div>
        </div>
      </section>

      <section className="desktop-panel__section">
        <h3><Volume2 /> Allowlists</h3>
        <p className="hgi-card__note">
          The backend enforces these lists. The page can only edit them; it can never add an action. Every Tier 2 entry
          still needs approval each time it runs.
        </p>

        <h4>Apps ({desktopAllowlist?.allowlist.apps.length ?? 0})</h4>
        <ul className="desktop-allow-list">
          {(desktopAllowlist?.allowlist.apps ?? []).map((app) => (
            <li key={app.path}>
              <span><strong>{app.label}</strong><small>{app.path}</small></span>
              <button type="button" className="icon-button" aria-label={`Remove ${app.label}`} onClick={() => void deleteDesktopApp(app.path)}>
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
        <div className="desktop-allow-form">
          <input aria-label="App name" placeholder="Notepad" value={appLabel} onChange={(event) => setAppLabel(event.target.value)} />
          <input aria-label="Full app path" placeholder="C:\\Windows\\System32\\notepad.exe" value={appPath} onChange={(event) => setAppPath(event.target.value)} />
          <button
            type="button"
            className="hgi-btn"
            disabled={!appLabel.trim() || !appPath.trim()}
            onClick={() => void withBusy('app:add', async () => {
              const ok = await saveDesktopApp(appLabel.trim(), appPath.trim())
              if (ok) {
                setAppLabel('')
                setAppPath('')
              }
            })}
          >
            Add app
          </button>
        </div>

        <h4>Websites ({desktopAllowlist?.allowlist.urls.length ?? 0})</h4>
        <ul className="desktop-allow-list">
          {(desktopAllowlist?.allowlist.urls ?? []).map((entry) => (
            <li key={entry.url}>
              <span><strong>{entry.label}</strong><small>{entry.url}</small></span>
              <button type="button" className="icon-button" aria-label={`Remove ${entry.label}`} onClick={() => void deleteDesktopUrl(entry.url)}>
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
        <div className="desktop-allow-form">
          <input aria-label="Website name" placeholder="YouTube" value={urlLabel} onChange={(event) => setUrlLabel(event.target.value)} />
          <input aria-label="Website address" placeholder="https://www.youtube.com" value={urlUrl} onChange={(event) => setUrlUrl(event.target.value)} />
          <button
            type="button"
            className="hgi-btn"
            disabled={!urlLabel.trim() || !urlUrl.trim()}
            onClick={() => void withBusy('url:add', async () => {
              const ok = await saveDesktopUrl(urlLabel.trim(), urlUrl.trim())
              if (ok) {
                setUrlLabel('')
                setUrlUrl('')
              }
            })}
          >
            Add website
          </button>
        </div>
        <p className="hgi-card__note">Only http and https addresses are accepted. Other schemes are rejected by the backend.</p>

        <h4>Shortcuts</h4>
        <ul className="desktop-shortcut-list">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.id}>
              <label>
                <input
                  type="checkbox"
                  checked={shortcut.enabled}
                  disabled={busyAction === `shortcut:${shortcut.id}`}
                  onChange={() => toggleShortcut(shortcut.id)}
                />
                <span>{shortcut.label}<small>{shortcut.keys.join(' + ')}</small></span>
              </label>
            </li>
          ))}
        </ul>
        <p className="hgi-card__note">
          {tierGroups.tier1} Tier 1 · {tierGroups.tier2} Tier 2 · {tierGroups.tier3} Tier 3 actions are defined in{' '}
          <code>config/desktop_actions.json</code>. {desktopAllowlist?.blocked_message}
        </p>
      </section>

      <section className="desktop-panel__section">
        <h3><ShieldAlert /> Safety behaviour</h3>
        <ul className="hgi-safety">
          <li><ShieldCheck /> OFF by default with its own permission switch and a persistent red banner while ON.</li>
          <li><ShieldCheck /> Ctrl+Alt+Q, the Emergency Stop button, the screen-corner fail-safe, and “BOZZ stop” all stop control immediately.</li>
          <li><ShieldCheck /> Auto-off after 10 s in the background, 2 s of lost tracking after a gesture action, a socket or camera stop, or the configured idle time.</li>
          <li><ShieldCheck /> Localhost-only bridge with a per-session token, typed schema, confidence floor, rate limit, and an audit log without camera or audio data.</li>
          <li><ShieldCheck /> Tier 3 actions — shell, scripts, file delete/move/rename, system changes, installs, passwords, messages, payments, security changes, shutdown — are blocked with no override.</li>
        </ul>
      </section>
    </div>
  )
}
