import { describe, expect, it } from 'vitest'
import {
  clampToWorkArea,
  dockPoint,
  easeInOut,
  isInsideWorkArea,
  randomTarget,
  stepToward,
} from '../../../electron/mini/wander.cjs'

const SIZE = { width: 240, height: 250 }
const MARGIN = 16

// workArea values, exactly as Electron's screen API reports them: the taskbar
// is already excluded, and secondary displays can have negative coordinates.
const DISPLAYS = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: 0, y: 0, width: 1366, height: 728 },
  { x: -1920, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: -200, width: 2560, height: 1400 },
  { x: 0, y: 0, width: 400, height: 300 },
]

describe('randomTarget', () => {
  it('always places the whole window inside the display work area', () => {
    for (const area of DISPLAYS) {
      for (let index = 0; index < 500; index += 1) {
        const point = randomTarget(area, SIZE.width, SIZE.height, MARGIN)
        expect(isInsideWorkArea(point.x, point.y, SIZE.width, SIZE.height, area)).toBe(true)
        expect(point.x).toBeGreaterThanOrEqual(area.x + MARGIN)
        expect(point.y).toBeGreaterThanOrEqual(area.y + MARGIN)
        expect(point.x + SIZE.width).toBeLessThanOrEqual(area.x + area.width - MARGIN)
        expect(point.y + SIZE.height).toBeLessThanOrEqual(area.y + area.height - MARGIN)
      }
    }
  })

  it('never covers a taskbar when the work area already excludes it', () => {
    // 1920x1080 screen with a 40 px bottom taskbar → work area height 1040.
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    for (let index = 0; index < 200; index += 1) {
      const point = randomTarget(area, SIZE.width, SIZE.height, MARGIN)
      expect(point.y + SIZE.height).toBeLessThanOrEqual(1040)
    }
  })

  it('is deterministic when random values are injected', () => {
    const area = { x: 0, y: 0, width: 1000, height: 800 }
    expect(randomTarget(area, 240, 250, 16, () => 0)).toEqual({ x: 16, y: 16 })
    const low = randomTarget(area, 240, 250, 16, () => 0)
    const high = randomTarget(area, 240, 250, 16, () => 1)
    expect(high.x).toBe(1000 - 240 - 16)
    expect(high.y).toBe(800 - 250 - 16)
    expect(high.x).toBeGreaterThan(low.x)
  })

  it('survives a display smaller than the window', () => {
    const area = { x: 0, y: 0, width: 120, height: 120 }
    const point = randomTarget(area, SIZE.width, SIZE.height, MARGIN)
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
    expect(point.x).toBe(16)
    expect(point.y).toBe(16)
  })
})

describe('clampToWorkArea', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 }

  it('clamps every edge', () => {
    expect(clampToWorkArea(-9999, -9999, 240, 250, area, 16)).toEqual({ x: -1904, y: 16 })
    expect(clampToWorkArea(9999, 9999, 240, 250, area, 16)).toEqual({
      x: -1920 + 1920 - 240 - 16,
      y: 1040 - 250 - 16,
    })
  })

  it('keeps a valid position unchanged', () => {
    expect(clampToWorkArea(-1000, 300, 240, 250, area, 16)).toEqual({ x: -1000, y: 300 })
  })
})

describe('dockPoint', () => {
  for (const area of DISPLAYS) {
    it(`docks inside ${area.width}x${area.height} at ${area.x},${area.y}`, () => {
      const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
      for (const corner of corners) {
        const point = dockPoint(corner, area, SIZE.width, SIZE.height, MARGIN)
        expect(isInsideWorkArea(point.x, point.y, SIZE.width, SIZE.height, area)).toBe(true)
        // Never below the work area, which is where the taskbar would be.
        expect(point.y + SIZE.height).toBeLessThanOrEqual(area.y + area.height)
      }
    })
  }
})

describe('stepToward', () => {
  it('starts and ends exactly on the endpoints', () => {
    const from = { x: 100, y: 200 }
    const to = { x: 500, y: 600 }
    expect(stepToward(from, to, 0)).toEqual(from)
    expect(stepToward(from, to, 1)).toEqual(to)
    expect(stepToward(from, to, -5)).toEqual(from)
    expect(stepToward(from, to, 5)).toEqual(to)
  })

  it('moves monotonically inside a work area for every eased step', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    const from = { x: 16, y: 16 }
    const to = { x: 1920 - 240 - 16, y: 1040 - 250 - 16 }
    let previous = from
    for (let step = 0; step <= 60; step += 1) {
      const point = stepToward(from, to, step / 60)
      expect(point.x).toBeGreaterThanOrEqual(previous.x)
      expect(point.y).toBeGreaterThanOrEqual(previous.y)
      expect(isInsideWorkArea(point.x, point.y, SIZE.width, SIZE.height, area)).toBe(true)
      previous = point
    }
  })
})

describe('easeInOut', () => {
  it('is clamped, symmetric and monotonic', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOut(-1)).toBe(0)
    expect(easeInOut(2)).toBe(1)
    let previous = 0
    for (let step = 0; step <= 100; step += 1) {
      const value = easeInOut(step / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})
