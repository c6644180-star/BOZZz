import { useEffect, useRef, useState } from 'react'
import { Hand, Mic, MicOff, OctagonAlert, Power, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, Square } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useHgi } from './hgiContext'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { gestureLabel } from '../../hgi/classification/builtinGestures'
import { controlRect } from '../../hgi/geometry'
import { GestureFeedbackOverlay } from './GestureFeedbackOverlay'
import type { PendingApproval } from '../../hgi/desktop/desktopSocket'

const MODE_LABEL = {
  orb: 'Orb',
  cursor: 'Cursor',
  desktop: 'Desktop',
} as const

const MODE_HINT = {
  orb: 'Pinch + move spins the orb · two pinched hands zoom · flick resets',
  cursor: 'Point to move · pinch clicks · pinch-hold drags · two fingers scroll · open palm 1 s pauses',
  desktop: 'Desktop mode sends real mouse commands only while Desktop Control is on',
} as const

function CameraHud() {
  const {
    enabled,
    starting,
    mode,
    paused,
    metrics,
    error,
    desktopEnabled,
    desktopConnection,
    toggleEnabled,
    cycleMode,
    setMode,
    resetOrb,
  } = useHgi()
  if (!enabled && !starting && !error) return null

  const cameraActive = enabled && metrics.cameraActive
  const statusText = starting
    ? 'STARTING CAMERA'
    : metrics.source === 'replay'
      ? 'REPLAYING RECORDING'
      : cameraActive
        ? 'CAMERA ACTIVE'
        : enabled
          ? 'CAMERA INACTIVE'
          : 'GESTURES OFF'
  return (
    <div className={`hgi-hud ${paused ? 'is-paused' : ''}`} role="status" aria-live="polite">
      <div className="hgi-hud__head">
        <span className={`hgi-live-dot ${cameraActive ? 'is-live' : starting ? 'is-waiting' : ''}`} aria-hidden="true" />
        <strong>{statusText}</strong>
        <span className="hgi-hud__mode">{MODE_LABEL[mode]}</span>
      </div>
      {error && <p className="hgi-hud__error">{error}</p>}
      <div className="hgi-hud__modes" role="group" aria-label="Gesture mode">
        {(['orb', 'cursor', 'desktop'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={mode === item ? 'is-active' : ''}
            onClick={() => setMode(item)}
            aria-pressed={mode === item}
          >
            {MODE_LABEL[item]}
          </button>
        ))}
        <button type="button" onClick={cycleMode} title="Cycle mode (M)" aria-label="Cycle gesture mode">M</button>
      </div>
      <dl className="hgi-hud__stats">
        <div>
          <dt>Gesture</dt>
          <dd>
            {gestureLabel(metrics.currentGesture)}
            <small>{metrics.currentGesture ? `${Math.round(metrics.gestureConfidence * 100)}%` : '—'}</small>
          </dd>
        </div>
        <div>
          <dt>Hands</dt>
          <dd>{metrics.hands}</dd>
        </div>
        <div>
          <dt>Inference</dt>
          <dd>{metrics.fps} fps</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{metrics.latencyMs} ms</dd>
        </div>
      </dl>
      <p className="hgi-hud__hint">
        {paused ? 'Paused — hold an open palm for 1 s (or press P) to resume.' : MODE_HINT[mode]}
      </p>
      <p className="hgi-hud__note">{metrics.note}</p>
      {desktopEnabled && (
        <p className={`hgi-hud__desktop hgi-hud__desktop--${desktopConnection}`}>
          <ShieldCheck /> Desktop bridge: {desktopConnection}
        </p>
      )}
      <p className="hgi-hud__age">No frames are stored. The camera is released when gestures are off.</p>
      <div className="hgi-hud__actions">
        <button type="button" className="hgi-btn" onClick={() => void toggleEnabled()}>
          <Power /> Off
        </button>
        <button type="button" className="hgi-btn" onClick={resetOrb} title="Reset orb (R)">
          <RotateCcw /> Reset
        </button>
        <Link className="hgi-btn hgi-btn--accent" to="/gesture">
          <Hand /> Gesture Lab
        </Link>
      </div>
    </div>
  )
}

function HgiCursor() {
  const { enabled, mode, cursorVisible, subscribeCursor } = useHgi()
  const ref = useRef<HTMLDivElement | null>(null)
  const active = enabled && mode === 'cursor'

  useEffect(() => {
    const node = ref.current
    if (!node) return
    return subscribeCursor((x, y) => {
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`
    })
  }, [subscribeCursor])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.dataset.active = active && cursorVisible ? 'true' : 'false'
  }, [active, cursorVisible])

  return (
    <div ref={ref} className="hgi-cursor" data-active={active && cursorVisible ? 'true' : 'false'} aria-hidden="true">
      <span className="hgi-cursor__ring" />
      <span className="hgi-cursor__dot" />
    </div>
  )
}

function DesktopBanner() {
  const {
    desktopEnabled,
    desktopConnection,
    desktopStatus,
    desktopDetail,
    desktopState,
    desktopApprovals,
    emergencyStop,
    disableDesktop,
  } = useHgi()
  const show = desktopEnabled || desktopConnection === 'stopped'
  if (!show) return null
  const stopped = desktopConnection === 'stopped' || desktopStatus?.emergency_stopped
  return (
    <div className={`hgi-desktop-banner ${stopped ? 'is-stopped' : 'is-on'}`} role="alert" aria-live="assertive">
      <span className="hgi-desktop-banner__dot" aria-hidden="true" />
      <div className="hgi-desktop-banner__text">
        <strong>{stopped ? 'DESKTOP CONTROL STOPPED' : 'DESKTOP CONTROL ON'}</strong>
        <p>
          {desktopDetail ??
            (stopped
              ? 'Emergency stop is latched. Restart the backend after checking the pointer and control area.'
              : `${desktopState} · ${desktopConnection}${desktopStatus?.screen ? ` · ${desktopStatus.screen.width}×${desktopStatus.screen.height}` : ''} · Ctrl+Alt+Q, the screen corner, or “BOZZ stop” stops everything`)}
        </p>
        {!stopped && desktopApprovals.length > 0 && (
          <p className="hgi-desktop-banner__pending">{desktopApprovals.length} action waiting for approval — say “approve” or use the dialog.</p>
        )}
      </div>
      {!stopped && (
        <button type="button" className="hgi-btn hgi-btn--danger" onClick={() => void emergencyStop()}>
          <OctagonAlert /> Emergency Stop
        </button>
      )}
      <button type="button" className="hgi-btn" onClick={() => void disableDesktop()}>
        Turn off
      </button>
    </div>
  )
}

function ApprovalDialog({ approval }: { approval: PendingApproval }) {
  const { approveDesktop, approveLatest } = useHgi()
  const [startedAt] = useState(() => performance.now())
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 200)
    return () => window.clearInterval(timer)
  }, [])
  const remaining = Math.max(0, approval.expires_in_ms - (now - startedAt))

  const expired = remaining <= 0
  return (
    <div className="desktop-approval-layer" role="presentation">
      <div className="desktop-approval-dialog" role="dialog" aria-modal="true" aria-label="Desktop action approval">
        <h3><ShieldAlert /> Approve this desktop action?</h3>
        <p className="desktop-approval-dialog__label">{approval.label}</p>
        <dl>
          <div><dt>Tier</dt><dd>{approval.tier} — approval required every time</dd></div>
          <div><dt>Target</dt><dd>{approval.target ?? '—'}</dd></div>
          <div><dt>Source</dt><dd>{approval.source}</dd></div>
          <div><dt>Expires</dt><dd>{expired ? 'expired — nothing was executed' : `${Math.ceil(remaining / 1000)} s`}</dd></div>
        </dl>
        <div className="desktop-approval-dialog__actions">
          <button
            type="button"
            className="hgi-btn hgi-btn--accent"
            disabled={expired}
            onClick={() => void approveDesktop(approval.approval_id, true, 'ui')}
          >
            <ShieldCheck /> Approve
          </button>
          <button
            type="button"
            className="hgi-btn hgi-btn--danger"
            onClick={() => void approveDesktop(approval.approval_id, false, 'ui')}
          >
            Deny
          </button>
          <button type="button" className="hgi-btn" onClick={() => void approveLatest(false, 'ui')}>
            Deny all
          </button>
        </div>
        <p className="desktop-approval-dialog__hint">
          Hold a thumbs-up for 1.5 s or say “approve” to approve by hand or voice. A single pinch can never approve an action.
        </p>
      </div>
    </div>
  )
}

function ApprovalQueue() {
  const { desktopApprovals } = useHgi()
  if (desktopApprovals.length === 0) return null
  return <ApprovalDialog key={desktopApprovals[0].approval_id} approval={desktopApprovals[0]} />
}

function DictationBanner() {
  const { desktopDictation, stopDesktopDictation } = useHgi()
  const { caption, mic } = useBozzVoice()
  if (!desktopDictation?.active) return null
  const preview = mic.listening && caption.startsWith('Dictation:') ? caption.slice('Dictation:'.length).trim() : ''
  return (
    <div className="hgi-dictation-banner" role="alert" aria-live="polite">
      <span className="hgi-dictation-banner__dot" aria-hidden="true" />
      <div>
        <strong>DICTATION MODE</strong>
        <p>Speak to type into the focused window. Say “stop dictation” or press the Stop button. Never dictate passwords, card numbers, or private data.</p>
        <small>
          {preview ? `Live: ${preview}` : mic.listening ? 'Listening…' : 'Microphone not listening'} ·{' '}
          {desktopDictation.remaining_chars} of {desktopDictation.max_chars} characters left · stops after silence
        </small>
      </div>
      <button type="button" className="hgi-btn hgi-btn--danger" onClick={() => void stopDesktopDictation()}>
        <Square /> Stop dictation
      </button>
    </div>
  )
}

function MicIndicator() {
  const { mic, toggleListening } = useBozzVoice()
  if (!mic.listening) return null
  return (
    <button
      type="button"
      className="hgi-mic-indicator is-listening"
      onClick={toggleListening}
      aria-label="Microphone is listening. Click to turn the microphone off."
    >
      <span className="hgi-mic-indicator__dot" aria-hidden="true" />
      <Mic />
      <span>MICROPHONE ON</span>
      <MicOff />
    </button>
  )
}

function DesktopOverlay() {
  const { desktopEnabled, settings } = useHgi()
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  if (!desktopEnabled) return null
  const rect = controlRect(
    size.width,
    size.height,
    settings.desktop.area,
    settings.desktop.edgeMargin,
    settings.desktop.positionX,
    settings.desktop.positionY,
  )
  return (
    <div className="hgi-desktop-overlay" aria-hidden="true">
      <div
        className="hgi-desktop-overlay__rect"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      >
        <span>
          Mouse control area — {Math.round(settings.desktop.area * 100)}% · {settings.desktop.edgeMargin} px edges
        </span>
        <i className="is-nw" />
        <i className="is-ne" />
        <i className="is-sw" />
        <i className="is-se" />
      </div>
    </div>
  )
}

function Notice() {
  const { notice } = useHgi()
  if (!notice) return null
  return (
    <div className="hgi-notice" role="status" aria-live="polite">
      <Sparkles /> {notice}
    </div>
  )
}

export function HgiRuntime() {
  return (
    <>
      <CameraHud />
      <HgiCursor />
      <GestureFeedbackOverlay />
      <DesktopBanner />
      <DictationBanner />
      <ApprovalQueue />
      <DesktopOverlay />
      <MicIndicator />
      <Notice />
    </>
  )
}
