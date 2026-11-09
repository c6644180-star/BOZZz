// Lightweight real motion tracking: compares small webcam frames and reports
// where motion happens and how much of the frame it covers. No hand-landmark
// model, no recording — readings exist only while the camera is on.

export interface MotionReading {
  x: number      // horizontal motion centroid, 0..1
  y: number      // vertical motion centroid, 0..1
  activity: number // fraction of pixels that changed
  reach: number  // smoothed activity magnitude, ~0..1 (hand closer = larger)
}

export function startMotionTracking(
  stream: MediaStream,
  onReading: (reading: MotionReading) => void,
): () => void {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  void video.play().catch(() => undefined)

  const W = 64
  const H = 48
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return () => undefined

  let previous: Uint8ClampedArray | null = null
  let raf = 0
  let last = 0
  let disposed = false
  const smooth = { x: 0.5, y: 0.5, reach: 0 }

  const loop = (time: number) => {
    if (disposed) return
    raf = requestAnimationFrame(loop)
    if (time - last < 66 || video.readyState < 2) return
    last = time
    ctx.drawImage(video, 0, 0, W, H)
    const frame = ctx.getImageData(0, 0, W, H).data
    if (previous) {
      let sumX = 0
      let sumY = 0
      let count = 0
      for (let i = 0; i < frame.length; i += 4) {
        const diff = Math.abs(frame[i] - previous[i]) + Math.abs(frame[i + 1] - previous[i + 1]) + Math.abs(frame[i + 2] - previous[i + 2])
        if (diff > 60) {
          const pixel = i / 4
          sumX += pixel % W
          sumY += Math.floor(pixel / W)
          count++
        }
      }
      const activity = count / (W * H)
      if (activity > 0.012) {
        smooth.x += (sumX / count / W - smooth.x) * 0.35
        smooth.y += (sumY / count / H - smooth.y) * 0.35
        smooth.reach += (Math.min(1, activity * 5) - smooth.reach) * 0.18
        onReading({ x: smooth.x, y: smooth.y, activity, reach: smooth.reach })
      }
    }
    previous = frame.slice()
  }
  raf = requestAnimationFrame(loop)

  return () => {
    disposed = true
    cancelAnimationFrame(raf)
    video.srcObject = null
  }
}
