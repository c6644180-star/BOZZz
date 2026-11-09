import { useEffect, useRef } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import { useHgi } from './hgiContext'
import type { HandLandmarks } from '../../hgi/types'

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

export function CameraPreview() {
  const { enabled, starting, metrics, error, subscribePreview, getVideoElement, previewEpoch, toggleEnabled } = useHgi()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handsRef = useRef<HandLandmarks[]>([])
  const frameRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      handsRef.current = []
      dirtyRef.current = true
      return
    }
    const host = hostRef.current
    const video = getVideoElement()
    if (!host || !video) return
    video.classList.add('hgi-preview__video')
    video.muted = true
    video.playsInline = true
    host.appendChild(video)
    return () => {
      video.classList.remove('hgi-preview__video')
      if (video.parentElement === host) video.remove()
    }
  }, [enabled, previewEpoch, getVideoElement])

  useEffect(() => {
    const unsubscribe = subscribePreview((hands) => {
      handsRef.current = hands
      dirtyRef.current = true
    })
    return unsubscribe
  }, [subscribePreview])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let stopped = false

    const draw = () => {
      if (stopped) return
      frameRef.current = requestAnimationFrame(draw)
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)
      const tokens = getComputedStyle(document.documentElement)
      const accent = tokens.getPropertyValue('--accent').trim() || '#f5b800'
      const ok = tokens.getPropertyValue('--ok').trim() || '#5fd38a'
      const warm = tokens.getPropertyValue('--warm-white').trim() || '#fff6dc'
      const hands = handsRef.current
      for (const hand of hands) {
        const points = hand.landmarks.map((point) => ({
          x: (1 - point.x) * width,
          y: point.y * height,
        }))
        context.globalAlpha = 0.9
        context.strokeStyle = hand.handedness === 'Left' ? ok : accent
        context.lineWidth = 2
        for (const [a, b] of CONNECTIONS) {
          if (!points[a] || !points[b]) continue
          context.beginPath()
          context.moveTo(points[a].x, points[a].y)
          context.lineTo(points[b].x, points[b].y)
          context.stroke()
        }
        context.globalAlpha = 0.95
        for (const point of points) {
          context.beginPath()
          context.arc(point.x, point.y, 2.4, 0, Math.PI * 2)
          context.fillStyle = warm
          context.fill()
        }
        const label = points[0]
        if (label) {
          context.fillStyle = warm
          context.font = '12px Inter, system-ui, sans-serif'
          context.fillText(`${hand.handedness} ${Math.round(hand.score * 100)}%`, label.x + 8, label.y + 16)
        }
        context.globalAlpha = 1
      }
    }

    frameRef.current = requestAnimationFrame(draw)
    return () => {
      stopped = true
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const live = enabled && metrics.cameraActive

  return (
    <div className="hgi-card hgi-camera">
      <div className="hgi-card__head">
        <h3><Camera /> Camera preview</h3>
        <span className={`hgi-chip ${live ? 'is-live' : ''}`}>{live ? 'LIVE · NOT RECORDED' : starting ? 'STARTING' : 'CAMERA OFF'}</span>
      </div>
      <div className="hgi-preview">
        <div ref={hostRef} className="hgi-preview__host" />
        <canvas ref={canvasRef} className="hgi-preview__canvas" width={480} height={360} aria-hidden="true" />
        {!live && (
          <div className="hgi-preview__off">
            <CameraOff />
            <strong>{starting ? 'Waiting for the camera…' : 'Camera released'}</strong>
            <p>{error ?? 'No video is shown until you start gesture control. Frames are processed in this tab only.'}</p>
            {!enabled && !starting && (
              <button type="button" className="hgi-btn hgi-btn--accent" onClick={() => void toggleEnabled()}>
                <Camera /> Start camera and gestures
              </button>
            )}
          </div>
        )}
      </div>
      <p className="hgi-card__note">
        Local hand landmarks only. Video frames are never recorded, stored, or uploaded. The skeleton doubles as proof that tracking is live.
      </p>
    </div>
  )
}
