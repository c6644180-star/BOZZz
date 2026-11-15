/**
 * Cursor assist for webcam hand control.
 *
 * A webcam hand cursor jitters and a pinch can be missed. Two optional helpers make
 * the cursor easier to use without weakening any safety rule:
 *
 * - Snap: a gentle pull toward the centre of the nearest button/link, so small hand
 *   tremor does not slide the cursor off a target.
 * - Dwell: hold the cursor still on a control for about a second to click it. It is
 *   an alternative to pinching, and it NEVER clicks controls marked dangerous
 *   (delete, send, publish, approve ...): those still need a deliberate pinch + confirm.
 */

export interface CursorAssistSettings {
  snap: boolean
  snapRadius: number
  dwell: boolean
  dwellMs: number
}

export const DEFAULT_CURSOR_ASSIST: CursorAssistSettings = {
  snap: true,
  snapRadius: 44,
  dwell: false,
  dwellMs: 1200,
}

const KEY = 'bozz.hgi.cursor-assist'
const listeners = new Set<() => void>()
let cached: CursorAssistSettings | null = null

function clampSettings(value: Partial<CursorAssistSettings>): CursorAssistSettings {
  return {
    snap: value.snap ?? DEFAULT_CURSOR_ASSIST.snap,
    snapRadius: Math.min(120, Math.max(10, Number(value.snapRadius ?? DEFAULT_CURSOR_ASSIST.snapRadius))),
    dwell: value.dwell ?? DEFAULT_CURSOR_ASSIST.dwell,
    dwellMs: Math.min(3000, Math.max(600, Number(value.dwellMs ?? DEFAULT_CURSOR_ASSIST.dwellMs))),
  }
}

export function loadCursorAssist(): CursorAssistSettings {
  if (cached) return cached
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    cached = clampSettings(raw ? (JSON.parse(raw) as Partial<CursorAssistSettings>) : {})
  } catch {
    cached = { ...DEFAULT_CURSOR_ASSIST }
  }
  return cached
}

export function saveCursorAssist(patch: Partial<CursorAssistSettings>): CursorAssistSettings {
  cached = clampSettings({ ...loadCursorAssist(), ...patch })
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // Private mode or full storage: keep the in-memory value for this session.
  }
  listeners.forEach((listener) => listener())
  return cached
}

export function subscribeCursorAssist(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetCursorAssistCache(): void {
  cached = null
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

function distanceToBox(x: number, y: number, box: Box): number {
  const dx = Math.max(box.left - x, 0, x - (box.left + box.width))
  const dy = Math.max(box.top - y, 0, y - (box.top + box.height))
  return Math.hypot(dx, dy)
}

/**
 * Pull (x, y) toward the centre of the nearest box within `radius`. Returns the same
 * point when nothing is near. `index` is the chosen box so callers can keep it stable.
 */
export function snapPoint(
  x: number,
  y: number,
  boxes: readonly Box[],
  radius: number,
  strength = 0.55,
): { x: number; y: number; index: number } {
  let best = -1
  let bestDistance = Infinity
  let bestArea = Infinity
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index]
    const distance = distanceToBox(x, y, box)
    if (distance > radius) continue
    const area = box.width * box.height
    if (distance < bestDistance || (distance === bestDistance && area < bestArea)) {
      best = index
      bestDistance = distance
      bestArea = area
    }
  }
  if (best < 0) return { x, y, index: -1 }
  const box = boxes[best]
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  return { x: x + (cx - x) * strength, y: y + (cy - y) * strength, index: best }
}

export interface DwellState {
  progress: number
  fire: boolean
}

/**
 * Hold still on one target to click it. Fires once, then waits for the cursor to
 * leave the target (for `rearmMs`) before it can fire again, so a resting hand never
 * produces a stream of clicks.
 */
export class DwellTracker {
  private anchorKey: string | null = null
  private anchorX = 0
  private anchorY = 0
  private startedAt = 0
  private firedKey: string | null = null
  private leftAt = 0

  private dwellMs: number
  private readonly tolerancePx: number
  private readonly rearmMs: number

  constructor(dwellMs: number, tolerancePx = 22, rearmMs = 350) {
    this.dwellMs = dwellMs
    this.tolerancePx = tolerancePx
    this.rearmMs = rearmMs
  }

  setDwellMs(value: number): void {
    this.dwellMs = value
  }

  reset(): void {
    this.anchorKey = null
    this.firedKey = null
    this.startedAt = 0
  }

  update(x: number, y: number, key: string | null, now: number): DwellState {
    if (key === null) {
      if (this.leftAt === 0) this.leftAt = now
      if (this.firedKey !== null && now - this.leftAt >= this.rearmMs) this.firedKey = null
      this.anchorKey = null
      this.startedAt = 0
      return { progress: 0, fire: false }
    }
    this.leftAt = 0
    // Stepping onto a different control re-arms immediately; the same one needs a real exit.
    if (this.firedKey !== null && key !== this.firedKey) this.firedKey = null
    const moved = Math.hypot(x - this.anchorX, y - this.anchorY) > this.tolerancePx
    if (key !== this.anchorKey || moved) {
      this.anchorKey = key
      this.anchorX = x
      this.anchorY = y
      this.startedAt = now
      return { progress: 0, fire: false }
    }
    if (this.firedKey === key) return { progress: 1, fire: false }
    const progress = Math.min(1, (now - this.startedAt) / this.dwellMs)
    if (progress >= 1) {
      this.firedKey = key
      return { progress: 1, fire: true }
    }
    return { progress, fire: false }
  }
}
