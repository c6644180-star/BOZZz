import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CURSOR_ASSIST,
  DwellTracker,
  loadCursorAssist,
  resetCursorAssistCache,
  saveCursorAssist,
  snapPoint,
} from '../cursorAssist'

const boxes = [
  { left: 100, top: 100, width: 80, height: 40 },
  { left: 300, top: 100, width: 80, height: 40 },
]

describe('snapPoint', () => {
  it('leaves the cursor alone when nothing is near', () => {
    expect(snapPoint(600, 600, boxes, 44)).toEqual({ x: 600, y: 600, index: -1 })
  })

  it('pulls toward the centre of the nearest box within the radius', () => {
    const result = snapPoint(190, 120, boxes, 44)
    expect(result.index).toBe(0)
    expect(result.x).toBeLessThan(190)
    expect(result.x).toBeGreaterThan(140)
    expect(result.y).toBeCloseTo(120, 5)
  })

  it('chooses the nearer of two boxes', () => {
    expect(snapPoint(285, 120, boxes, 44).index).toBe(1)
  })

  it('ignores boxes outside the radius', () => {
    expect(snapPoint(215, 120, boxes, 20).index).toBe(-1)
  })

  it('prefers the smaller box on a tie so small buttons are reachable', () => {
    const nested = [
      { left: 0, top: 0, width: 400, height: 400 },
      { left: 90, top: 90, width: 20, height: 20 },
    ]
    expect(snapPoint(100, 100, nested, 30).index).toBe(1)
  })
})

describe('DwellTracker', () => {
  it('fires once after holding still on one target', () => {
    const dwell = new DwellTracker(1000)
    expect(dwell.update(10, 10, 'a', 0)).toEqual({ progress: 0, fire: false })
    expect(dwell.update(11, 10, 'a', 500).progress).toBeCloseTo(0.5, 5)
    expect(dwell.update(11, 11, 'a', 1000)).toEqual({ progress: 1, fire: true })
    expect(dwell.update(11, 11, 'a', 1500).fire).toBe(false)
    expect(dwell.update(11, 11, 'a', 4000).fire).toBe(false)
  })

  it('restarts when the cursor moves away or the target changes', () => {
    const dwell = new DwellTracker(1000, 22)
    dwell.update(10, 10, 'a', 0)
    expect(dwell.update(200, 10, 'a', 600).progress).toBe(0)
    expect(dwell.update(200, 10, 'b', 900).progress).toBe(0)
    expect(dwell.update(200, 10, 'b', 1500).progress).toBeCloseTo(0.6, 5)
  })

  it('does not fire on empty space and re-arms only after leaving the target', () => {
    const dwell = new DwellTracker(500, 22, 300)
    dwell.update(0, 0, null, 0)
    dwell.update(0, 0, 'a', 10)
    expect(dwell.update(0, 0, 'a', 510).fire).toBe(true)
    // Immediately stepping off and back on is not enough
    dwell.update(0, 0, null, 520)
    dwell.update(0, 0, 'a', 600)
    expect(dwell.update(0, 0, 'a', 1200).fire).toBe(false)
    // Leaving for the re-arm time then returning allows another click
    dwell.update(0, 0, null, 1300)
    dwell.update(0, 0, null, 1700)
    dwell.update(0, 0, 'a', 1710)
    expect(dwell.update(0, 0, 'a', 2300).fire).toBe(true)
  })
})

describe('cursor assist settings', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    })
    resetCursorAssistCache()
  })

  it('has safe defaults: snap on, dwell off', () => {
    expect(loadCursorAssist()).toEqual(DEFAULT_CURSOR_ASSIST)
    expect(DEFAULT_CURSOR_ASSIST.dwell).toBe(false)
  })

  it('clamps stored values to a safe range', () => {
    saveCursorAssist({ dwellMs: 50, snapRadius: 9999 })
    expect(loadCursorAssist().dwellMs).toBe(600)
    expect(loadCursorAssist().snapRadius).toBe(120)
  })
})
