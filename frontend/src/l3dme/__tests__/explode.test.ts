import { describe, expect, it } from 'vitest'
import {
  applyExplodePlan,
  buildExplodePlan,
  clampExplode,
  directionFromCenter,
  explodedPosition,
} from '../explode'

describe('exploded view maths', () => {
  it('clamps the slider and rejects non-finite values', () => {
    expect(clampExplode(-1)).toBe(0)
    expect(clampExplode(0.4)).toBe(0.4)
    expect(clampExplode(2)).toBe(1)
    expect(clampExplode(Number.NaN)).toBe(0)
    expect(clampExplode(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('restores the exact base position at zero', () => {
    const plan = buildExplodePlan(
      [{ key: 'cube', base: { x: 2, y: 0, z: 0 } }],
      { x: 0, y: 0, z: 0 },
      4,
    )
    expect(explodedPosition(plan[0], 0)).toEqual({ x: 2, y: 0, z: 0 })
  })

  it('moves a part outward along its direction from the centre', () => {
    const plan = buildExplodePlan(
      [{ key: 'cube', base: { x: 2, y: 0, z: 0 } }],
      { x: 0, y: 0, z: 0 },
      4,
    )
    expect(explodedPosition(plan[0], 0.5)).toEqual({ x: 4, y: 0, z: 0 })
    expect(explodedPosition(plan[0], 1)).toEqual({ x: 6, y: 0, z: 0 })
  })

  it('uses a normalised direction in three dimensions', () => {
    const direction = directionFromCenter({ x: 1, y: 2, z: 2 }, { x: 1, y: 0, z: 0 })
    expect(direction.x).toBeCloseTo(0)
    expect(direction.y).toBeCloseTo(Math.SQRT1_2)
    expect(direction.z).toBeCloseTo(Math.SQRT1_2)
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1)
  })

  it('does not invent motion for a part at the exact centre', () => {
    const plan = buildExplodePlan(
      [{ key: 'centre', base: { x: 0, y: 0, z: 0 } }],
      { x: 0, y: 0, z: 0 },
      10,
    )
    expect(explodedPosition(plan[0], 1)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('applies offsets to every top-level part', () => {
    const plan = buildExplodePlan(
      [
        { key: 'left', base: { x: -1, y: 0, z: 0 } },
        { key: 'right', base: { x: 1, y: 0, z: 0 } },
      ],
      { x: 0, y: 0, z: 0 },
      2,
    )
    const result = applyExplodePlan(plan, 0.5)
    expect(result[0]).toEqual({ key: 'left', position: { x: -2, y: 0, z: 0 } })
    expect(result[1]).toEqual({ key: 'right', position: { x: 2, y: 0, z: 0 } })
  })
})
