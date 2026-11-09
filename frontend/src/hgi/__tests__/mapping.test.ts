import { describe, expect, it } from 'vitest'
import { applySensitivity, controlPoint, controlRect, mapCameraToViewport } from '../geometry'

describe('coordinate mapping', () => {
  it('mirrors camera x into the viewport with an inset', () => {
    expect(mapCameraToViewport(0, 0.5, 1000, 500, true, 0.1)).toEqual({ x: 900, y: 250 })
    expect(mapCameraToViewport(1, 0.5, 1000, 500, true, 0.1)).toEqual({ x: 100, y: 250 })
    expect(mapCameraToViewport(0.5, 0.5, 1000, 500, true, 0.1)).toEqual({ x: 500, y: 250 })
  })

  it('builds a centred control rectangle with edge margins', () => {
    const rect = controlRect(1366, 768, 0.8, 12)
    expect(rect.left).toBeCloseTo(136.6, 3)
    expect(rect.top).toBeCloseTo(76.8, 3)
    expect(rect.width).toBeCloseTo(1092.8, 3)
    expect(rect.height).toBeCloseTo(614.4, 3)

    const topLeft = controlPoint(0, 0, rect)
    expect(topLeft.x).toBeCloseTo(rect.left + 12, 3)
    expect(topLeft.y).toBeCloseTo(rect.top + 12, 3)

    const bottomRight = controlPoint(1, 1, rect)
    expect(bottomRight.x).toBeCloseTo(rect.left + rect.width - 12, 3)
    expect(bottomRight.y).toBeCloseTo(rect.top + rect.height - 12, 3)

    const centre = controlPoint(0.5, 0.5, rect)
    expect(centre.x).toBeCloseTo(683, 3)
    expect(centre.y).toBeCloseTo(384, 3)
  })

  it('keeps points inside the rectangle when input is out of range', () => {
    const rect = controlRect(800, 600, 0.6, 10)
    expect(controlPoint(-1, 2, rect)).toEqual(controlPoint(0, 1, rect))
  })

  it('scales sensitivity around the centre and clamps to the screen', () => {
    expect(applySensitivity(0.5, 0.5, 2)).toEqual({ x: 0.5, y: 0.5 })
    expect(applySensitivity(0.9, 0.1, 2)).toEqual({ x: 1, y: 0 })
    expect(applySensitivity(0.7, 0.3, 0.5)).toEqual({ x: 0.6, y: 0.4 })
  })
})
