import { describe, expect, it } from 'vitest'
import { applyExplodePlan, buildExplodePlan } from '../../l3dme/explode'

const PARTS = [
  { key: '0', base: { x: 1.2345, y: 0, z: -0.1 } },
  { key: '1', base: { x: -2.5, y: 0.75, z: 3.14159 } },
  { key: '2', base: { x: 0.3333333333333333, y: -1.2, z: 0 } },
]

describe('hologram exploded view', () => {
  it('restores the exact original transforms when reassembled', () => {
    const plan = buildExplodePlan(PARTS, { x: 0, y: 0, z: 0 }, 2.75)
    for (const amount of [1, 0.6, 0.15, 0]) {
      applyExplodePlan(plan, amount)
    }
    const restored = applyExplodePlan(plan, 0)
    restored.forEach((item, index) => {
      expect(Object.is(item.position.x, PARTS[index].base.x)).toBe(true)
      expect(Object.is(item.position.y, PARTS[index].base.y)).toBe(true)
      expect(Object.is(item.position.z, PARTS[index].base.z)).toBe(true)
    })
  })

  it('does not mutate the recorded base transforms', () => {
    const plan = buildExplodePlan(PARTS, { x: 0, y: 0, z: 0 }, 4)
    applyExplodePlan(plan, 1)
    expect(plan.map((item) => item.base)).toEqual(PARTS.map((part) => part.base))
  })

  it('moves parts proportionally so the slider is reversible', () => {
    const plan = buildExplodePlan(PARTS, { x: 0, y: 0, z: 0 }, 4)
    const half = applyExplodePlan(plan, 0.5)
    const full = applyExplodePlan(plan, 1)
    half.forEach((item, index) => {
      expect(item.position.x).toBeCloseTo((PARTS[index].base.x + full[index].position.x) / 2, 10)
      expect(item.position.z).toBeCloseTo((PARTS[index].base.z + full[index].position.z) / 2, 10)
    })
  })
})
