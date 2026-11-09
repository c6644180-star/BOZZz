import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Hand, Minus, Plus, RotateCcw } from 'lucide-react'
import type { OrbScene } from './threeScene'
import { CrystalStar } from './CrystalStar'
import { startMotionTracking } from '../../services/motionGesture'
import type { OrbState } from '../../types/bozz'

type GestureStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unavailable'

const stateCopy: Record<OrbState, string> = {
  idle: 'CORE IDLE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'SPEAKING',
  error: 'VOICE ERROR',
  offline: 'OFFLINE · LOCAL MODE',
}

const MIN_R = 4.5
const MAX_R = 14
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function BozzOrb({ state, className = '' }: { state: OrbState; className?: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<OrbScene | null>(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchBase = useRef<{ dist: number; radius: number } | null>(null)
  const [gesture, setGesture] = useState<GestureStatus>('off')
  const gestureBase = useRef({ theta: 0, phi: 0 })
  const streamRef = useRef<MediaStream | null>(null)
  const stopTrackingRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)

  const stateRef = useRef(state)
  const mountedRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
    sceneRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    const el = mountRef.current
    if (!el || webglFailed || mountedRef.current) return
    mountedRef.current = true
    let disposed = false
    void import('./threeScene').then(({ createOrbScene }) => {
      if (disposed) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const scene = createOrbScene(el, reduced)
      if (!scene) { setWebglFailed(true); return }
      sceneRef.current = scene
      scene.setState(stateRef.current)
    }).catch(() => { if (!disposed) setWebglFailed(true) })
    return () => {
      disposed = true
      mountedRef.current = false
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [webglFailed])

  useEffect(() => () => {
    stopTrackingRef.current?.()
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    const stopGestureControl = () => {
      stopTrackingRef.current?.()
      stopTrackingRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setGesture('off')
    }
    window.addEventListener('bozz-emergency-stop', stopGestureControl)
    return () => window.removeEventListener('bozz-emergency-stop', stopGestureControl)
  }, [])

  useEffect(() => {
    if (previewRef.current && streamRef.current) previewRef.current.srcObject = streamRef.current
  }, [gesture])

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const scene = sceneRef.current
      if (!scene) return
      scene.orbit.radius = clamp(scene.orbit.radius * Math.exp(event.deltaY * 0.0012), MIN_R, MAX_R)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinchBase.current = null
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const scene = sceneRef.current
    const stored = pointers.current.get(event.pointerId)
    if (!scene || !stored) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 1) {
      const dx = event.clientX - stored.x
      const dy = event.clientY - stored.y
      scene.orbit.theta -= dx * 0.008
      scene.orbit.phi = clamp(scene.orbit.phi - dy * 0.006, 0.35, 2.6)
      gestureBase.current = { theta: scene.orbit.theta, phi: scene.orbit.phi }
      return
    }
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (!pinchBase.current) pinchBase.current = { dist, radius: scene.orbit.radius }
      else scene.orbit.radius = clamp(pinchBase.current.radius * (pinchBase.current.dist / dist), MIN_R, MAX_R)
    }
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchBase.current = null
  }

  function nudgeRadius(factor: number) {
    const scene = sceneRef.current
    if (scene) scene.orbit.radius = clamp(scene.orbit.radius * factor, MIN_R, MAX_R)
  }

  function resetView() {
    sceneRef.current?.resetView()
    gestureBase.current = { theta: 0.35, phi: 1.32 }
  }

  async function toggleGesture() {
    if (gesture === 'on') {
      stopTrackingRef.current?.()
      stopTrackingRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setGesture('off')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) { setGesture('unavailable'); return }
    setGesture('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false })
      streamRef.current = stream
      const scene = sceneRef.current
      gestureBase.current = { theta: scene?.orbit.theta ?? 0.35, phi: scene?.orbit.phi ?? 1.32 }
      stopTrackingRef.current = startMotionTracking(stream, (reading) => {
        const s = sceneRef.current
        if (!s) return
        s.orbit.theta = gestureBase.current.theta + (reading.x - 0.5) * 2.4
        s.orbit.phi = clamp(gestureBase.current.phi - (reading.y - 0.5) * 1.3, 0.35, 2.6)
        s.orbit.radius = clamp(10.5 - reading.reach * 4.5, MIN_R, MAX_R)
      })
      setGesture('on')
    } catch (err) {
      setGesture(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }

  return (
    <section className={`hologram ${state} ${className}`} aria-label={`BOZZ is ${state}. Drag to rotate, scroll or pinch to zoom.`}>
      <div className="floor-glow" aria-hidden="true" />
      {webglFailed ? (
        <div className="orb-core fallback-orb"><CrystalStar /></div>
      ) : (
        <div
          className="orb3d"
          ref={mountRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onDoubleClick={resetView}
        />
      )}

      <div className="orb-controls">
        <button onClick={() => nudgeRadius(0.85)} aria-label="Zoom in"><Plus /></button>
        <button onClick={() => nudgeRadius(1.18)} aria-label="Zoom out"><Minus /></button>
        <button onClick={resetView} aria-label="Reset orb view"><RotateCcw /></button>
        <button className={gesture === 'on' ? 'on' : ''} onClick={toggleGesture} aria-pressed={gesture === 'on'}
          aria-label={gesture === 'on' ? 'Turn motion control off' : 'Control orb with hand motion (needs camera permission)'}><Hand /></button>
      </div>
      <div className={`orb-state-readout state-${state}`} aria-live="polite">{stateCopy[state]}</div>

      {gesture === 'on' && (
        <div className="motion-hud">
          <video ref={previewRef} className="motion-preview" autoPlay muted playsInline />
          <span className="motion-badge">● MOTION CONTROL ACTIVE — camera on for this session only, nothing is recorded</span>
        </div>
      )}
      {gesture === 'requesting' && <div className="motion-note">Waiting for your camera permission…</div>}
      {gesture === 'denied' && <div className="motion-note">Camera permission denied — drag and pinch still work.</div>}
      {gesture === 'unavailable' && <div className="motion-note">Camera not available in this browser — drag and pinch still work.</div>}
      {webglFailed && <div className="motion-note">3D needs WebGL — showing flat fallback.</div>}
    </section>
  )
}

export function CaptionBar({ caption, visible }: { caption: string; visible: boolean }) {
  if (!visible) return null
  return <div className="caption-bar" aria-live="polite"><span>{caption}</span></div>
}
