import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { Orb } from '../components/orb/Orb'
import { desktopBridge } from '../services/desktopBridge'
import type { MiniApproval, MiniConfig, MiniState } from '../types/desktop'

const INITIAL_STATE: MiniState = {
  orbState: 'idle',
  caption: '',
  listening: false,
  micAvailable: false,
  cameraActive: false,
  desktopOn: false,
  emergency: false,
  approval: null,
}

// Mirrors the main-process sanitizer defaults so the first paint is neutral.
const INITIAL_CONFIG: MiniConfig = {
  size: 'small',
  opacity: 0.96,
  wander: true,
  wanderSpeed: 'normal',
  dock: 'free',
  monitor: 'cursor',
  theme: 'gold',
  reduceMotion: false,
  captions: true,
  pauseOnBattery: true,
  pushToTalk: true,
  pushToTalkKey: 'Space',
}

function ApprovalPopup({
  approval,
  onResolve,
}: {
  approval: MiniApproval
  onResolve: (id: string, approve: boolean) => void
}) {
  // The backend issues its own deadline; mini mode never waits longer than 10 s
  // so a missed popup can never leave an action silently pending.
  const cap = Math.min(Math.max(approval.expiresInMs || 10000, 1000), 10000)
  const [remaining, setRemaining] = useState(cap)
  const resolveRef = useRef(onResolve)

  useEffect(() => {
    resolveRef.current = onResolve
  }, [onResolve])

  useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const left = Math.max(0, cap - (Date.now() - startedAt))
      setRemaining(left)
      if (left <= 0) {
        window.clearInterval(timer)
        resolveRef.current(approval.id, false)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [approval.id, cap])

  return (
    <div className="mini-approval" data-mini-hit role="alertdialog" aria-label="Desktop action approval">
      <p className="mini-approval__label">{approval.label}</p>
      <p className="mini-approval__meta">
        Tier {Math.min(3, Math.max(0, Math.round(approval.tier)))} · {approval.source}
      </p>
      <div className="mini-approval__actions">
        <button type="button" onClick={() => onResolve(approval.id, true)}>
          Approve
        </button>
        <button type="button" className="is-deny" onClick={() => onResolve(approval.id, false)}>
          Deny
        </button>
      </div>
      <div className="mini-approval__timer" aria-hidden="true">
        <span style={{ width: `${(remaining / cap) * 100}%` }} />
      </div>
      <span className="mini-approval__hint">{Math.ceil(remaining / 1000)}s · say “approve” to allow</span>
    </div>
  )
}

export default function MiniOrbPage() {
  const bridge = desktopBridge()
  const [state, setState] = useState<MiniState>(INITIAL_STATE)
  const [config, setConfig] = useState<MiniConfig>(INITIAL_CONFIG)
  const [paused, setPaused] = useState(false)
  const [hiddenApprovalId, setHiddenApprovalId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!bridge) return
    const offState = bridge.onMiniState(setState)
    const offConfig = bridge.onMiniConfig(setConfig)
    const offPause = bridge.onMiniPause((next) => setPaused(next.paused))
    return () => {
      offState()
      offConfig()
      offPause()
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    document.title = 'BOZZ Mini Orb'
    const root = document.documentElement
    root.dataset.surface = 'mini'
    root.dataset.theme = config.theme
    root.dataset.motion = config.reduceMotion ? 'reduced' : 'full'
    return () => {
      delete root.dataset.surface
    }
  }, [bridge, config.theme, config.reduceMotion])

  // The window starts click-through. Forwarded mouse moves tell us when the
  // pointer is really over the orb or the approval card, and only then does the
  // main process accept clicks. Empty transparent pixels stay click-through.
  const hoverRef = useRef(false)
  const draggingRef = useRef(false)
  useEffect(() => {
    if (!bridge) return
    const setHover = (value: boolean) => {
      if (hoverRef.current === value) return
      hoverRef.current = value
      bridge.sendMiniAction({ type: 'hover', value })
    }
    // The orb element is a square box around a round orb, so treat it as a
    // circle and keep the transparent corners click-through.
    const isHit = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-mini-hit]')
      if (!target) return false
      if (!target.classList.contains('mini-orb')) return true
      const rect = target.getBoundingClientRect()
      const radius = rect.width / 2
      return Math.hypot(x - (rect.left + radius), y - (rect.top + radius)) <= radius
    }
    const onMove = (event: MouseEvent) => {
      if (draggingRef.current) {
        setHover(true)
        return
      }
      setHover(isHit(event.clientX, event.clientY))
    }
    const onLeave = () => setHover(false)
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      setHover(false)
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    const matches = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return false
      if (config.pushToTalkKey === 'Control+Space') return event.ctrlKey
      if (config.pushToTalkKey === 'Alt+Space') return event.altKey
      return !event.ctrlKey && !event.altKey && !event.metaKey
    }
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault()
        bridge.sendMiniAction({ type: 'emergency-stop' })
        return
      }
      if (!config.pushToTalk || !matches(event) || event.repeat) return
      event.preventDefault()
      bridge.sendMiniAction({ type: 'ptt-start' })
    }
    const onUp = (event: KeyboardEvent) => {
      if (!config.pushToTalk || !matches(event)) return
      event.preventDefault()
      bridge.sendMiniAction({ type: 'ptt-end' })
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [bridge, config.pushToTalk, config.pushToTalkKey])

  const resolveApproval = useCallback(
    (id: string, approve: boolean) => {
      setHiddenApprovalId(id)
      bridge?.sendMiniAction({ type: 'approval', id, approve })
    },
    [bridge],
  )

  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  const tapAt = useRef(0)
  const tapTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
    }
  }, [])

  const onOrbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!bridge || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.screenX, startY: event.screenY, moved: false }
    bridge.sendMiniAction({ type: 'drag-start', screenX: event.screenX, screenY: event.screenY })
    draggingRef.current = true
    setDragging(true)
  }

  const onOrbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!bridge || !drag) return
    if (!drag.moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) < 4) return
    drag.moved = true
    bridge.sendMiniAction({ type: 'drag-move', screenX: event.screenX, screenY: event.screenY })
  }

  const onOrbPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    draggingRef.current = false
    setDragging(false)
    if (!bridge || !drag) return
    bridge.sendMiniAction({ type: 'drag-end', moved: drag.moved })
    if (drag.moved) return
    const now = Date.now()
    if (now - tapAt.current < 320) {
      tapAt.current = 0
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = null
      }
      bridge.sendMiniAction({ type: 'listen' })
      return
    }
    tapAt.current = now
    if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null
      bridge.sendMiniAction({ type: 'expand' })
    }, 320)
  }

  const orbVisualState = state.emergency ? 'error' : state.orbState
  // 12 fps is enough for the slow idle drift and halves GPU work on old
  // laptops; anything the user should react to runs at the 30 fps cap.
  const orbFps = state.listening || state.orbState !== 'idle' || state.emergency ? 30 : 12
  const approval = state.approval && state.approval.id !== hiddenApprovalId ? state.approval : null
  const captionVisible =
    Boolean(state.caption) &&
    (config.captions || state.orbState === 'error' || state.emergency) &&
    (state.listening || state.orbState === 'speaking' || state.orbState === 'thinking' || state.orbState === 'error' || state.emergency)

  if (!bridge) {
    return (
      <div className="mini-root mini-root--fallback">
        <div className="mini-fallback-card">
          <strong>Mini mode needs the desktop app.</strong>
          <p>The floating orb uses a native window, so it only exists when BOZZ runs with Electron.</p>
          <Link to="/">Back to BOZZ</Link>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`mini-root${config.size === 'medium' ? ' mini-root--medium' : ''}`}
      data-emergency={state.emergency ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      onContextMenu={(event) => {
        event.preventDefault()
        bridge.sendMiniAction({ type: 'menu' })
      }}
    >
      <div className="mini-stage">
        <div
          className="mini-orb"
          data-mini-hit
          role="button"
          tabIndex={0}
          aria-label="BOZZ mini orb. Click to expand, double-click to listen, right-click for the menu."
          title="Click: expand · Double-click: listen · Right-click: menu"
          onPointerDown={onOrbPointerDown}
          onPointerMove={onOrbPointerMove}
          onPointerUp={onOrbPointerUp}
          onPointerCancel={onOrbPointerUp}
        >
          <Orb
            state={orbVisualState}
            quality="mini"
            paused={paused}
            fps={orbFps}
            theme={config.theme}
            reducedMotion={config.reduceMotion}
          />
          {state.listening && <span className="mini-listen-ring" aria-hidden="true" />}
        </div>
        <div className="mini-flags">
          {state.listening && (
            <span className="mini-flag mini-flag--mic" data-mini-hit title="Microphone is listening">
              MIC
            </span>
          )}
          {state.cameraActive && (
            <span className="mini-flag mini-flag--camera" data-mini-hit title="Camera active — gesture engine is running">
              <i aria-hidden="true" />
              CAM
            </span>
          )}
          {state.desktopOn && (
            <span className="mini-flag mini-flag--desktop" data-mini-hit title="Desktop control is ON">
              <i aria-hidden="true" />
              Desktop ON
            </span>
          )}
        </div>
      </div>

      {captionVisible && (
        <p className="mini-caption" data-mini-hit aria-live="polite">
          {state.caption}
        </p>
      )}

      {state.emergency && (
        <p className="mini-emergency" data-mini-hit>
          EMERGENCY STOP
        </p>
      )}

      {approval && <ApprovalPopup approval={approval} onResolve={resolveApproval} />}
    </div>
  )
}
