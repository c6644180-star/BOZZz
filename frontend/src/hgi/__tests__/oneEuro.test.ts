import { describe, expect, it } from 'vitest'
import { OneEuroFilter } from '../filter/OneEuroFilter'

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    const filter = new OneEuroFilter(1.2, 0.35)
    expect(filter.filter(12.5, 0)).toBe(12.5)
  })

  it('keeps a constant signal constant', () => {
    const filter = new OneEuroFilter(1.2, 0.35)
    for (let index = 0; index < 30; index += 1) {
      expect(filter.filter(5, index * 50)).toBeCloseTo(5, 6)
    }
  })

  it('reduces alternating noise after warm-up', () => {
    const filter = new OneEuroFilter(0.8, 0.2)
    const outputs: number[] = []
    for (let index = 0; index < 60; index += 1) {
      const noisy = index % 2 === 0 ? 0 : 10
      const output = filter.filter(noisy, index * 50)
      if (index > 20) outputs.push(output)
    }
    const range = Math.max(...outputs) - Math.min(...outputs)
    expect(range).toBeLessThan(10)
    expect(range).toBeGreaterThan(0)
  })

  it('reports a positive velocity for a rising signal', () => {
    const filter = new OneEuroFilter(1, 0.4)
    filter.filter(0, 0)
    filter.filter(1, 50)
    expect(filter.velocity).toBeGreaterThan(0)
  })

  it('resets back to the first sample', () => {
    const filter = new OneEuroFilter()
    filter.filter(3, 0)
    filter.filter(9, 50)
    filter.reset()
    expect(filter.filter(42, 100)).toBe(42)
  })
})
