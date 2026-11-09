export interface FrameLighting {
  brightness: number
  contrast: number
}

export interface LightingInput {
  brightness: number
  contrast: number
  coverage: number | null
  score: number | null
}

export type LightingLevel = 'ok' | 'dark' | 'bright' | 'low-contrast' | 'out-of-frame' | 'weak-tracking' | 'unknown'

export interface LightingVerdict {
  level: LightingLevel
  measured: boolean
  brightness: number | null
  contrast: number | null
  coverage: number | null
  score: number | null
  advice: string
  detail: string
}

export const LIGHTING_ADVICE: Record<LightingLevel, string> = {
  ok: 'Lighting and framing look usable.',
  dark: 'Too dark — add a lamp in front of you or face a window. Avoid backlight behind you.',
  bright: 'Too bright — move away from direct light or close a curtain so your hand is not washed out.',
  'low-contrast': 'Low contrast — the hand blends into the background. Use a plain wall behind your hand.',
  'out-of-frame': 'Hand partly out of frame — move back until your whole hand is visible.',
  'weak-tracking': 'Tracking confidence is low — slow down and keep the palm facing the camera.',
  unknown: 'Not measured yet — start gestures so BOZZ can measure the camera image.',
}

// Samples a real camera frame at low resolution. Returns null when there is no
// playable video yet; BOZZ then shows "Not measured yet".
export function measureFrameLighting(video: HTMLVideoElement | null): FrameLighting | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let sum = 0
    let sumSquares = 0
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      const luma = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255
      sum += luma
      sumSquares += luma * luma
      count += 1
    }
    if (count === 0) return null
    const mean = sum / count
    const variance = Math.max(0, sumSquares / count - mean * mean)
    return { brightness: mean, contrast: Math.sqrt(variance) }
  } catch {
    return null
  }
}

export function landmarkCoverage(points: Array<{ x: number; y: number }>, margin = 0.04): number | null {
  if (points.length === 0) return null
  const inside = points.filter(
    (point) => point.x >= margin && point.y >= margin && point.x <= 1 - margin && point.y <= 1 - margin,
  ).length
  return inside / points.length
}

export function classifyLighting(input: LightingInput | null): LightingVerdict {
  if (!input || !Number.isFinite(input.brightness)) {
    return {
      level: 'unknown',
      measured: false,
      brightness: null,
      contrast: null,
      coverage: input?.coverage ?? null,
      score: input?.score ?? null,
      advice: LIGHTING_ADVICE.unknown,
      detail: 'No camera frame has been measured yet.',
    }
  }
  const brightness = Math.min(1, Math.max(0, input.brightness))
  const contrast = Math.max(0, input.contrast)
  const scores: Array<{ level: LightingLevel; hit: boolean }> = [
    { level: 'dark', hit: brightness < 0.18 },
    { level: 'bright', hit: brightness > 0.92 },
    { level: 'out-of-frame', hit: input.coverage !== null && input.coverage < 0.6 },
    { level: 'low-contrast', hit: contrast < 0.06 },
    { level: 'weak-tracking', hit: input.score !== null && input.score < 0.55 },
  ]
  const match = scores.find((item) => item.hit)
  const level: LightingLevel = match?.level ?? 'ok'
  const detail = [
    `brightness ${Math.round(brightness * 100)}%`,
    `contrast ${Math.round(contrast * 100)}%`,
    input.coverage === null ? 'hand coverage not measured' : `hand in frame ${Math.round(input.coverage * 100)}%`,
    input.score === null ? 'tracking confidence not measured' : `tracking confidence ${Math.round(input.score * 100)}%`,
  ].join(' · ')
  return {
    level,
    measured: true,
    brightness,
    contrast,
    coverage: input.coverage,
    score: input.score,
    advice: LIGHTING_ADVICE[level],
    detail,
  }
}
