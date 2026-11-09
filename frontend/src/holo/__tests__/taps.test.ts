import { describe, expect, it } from 'vitest'
import { TapRecognizer } from '../taps'

describe('TapRecognizer', () => {
  it('reports a quick tap only after the double-tap window closes', () => {
    const taps = new TapRecognizer()
    expect(taps.end('a', 120, 1_000)).toBeNull()
    expect(taps.pendingSingle(1_300)).toBeNull()
    expect(taps.pendingSingle(1_700)).toBe('a')
    expect(taps.pendingSingle(1_900)).toBeNull()
  })

  it('turns two taps on the same node within 600 ms into a double tap', () => {
    const taps = new TapRecognizer()
    expect(taps.end('a', 100, 1_000)).toBeNull()
    expect(taps.end('a', 140, 1_400)).toEqual({ kind: 'double', key: 'a' })
  })

  it('treats taps on different nodes as separate singles', () => {
    const taps = new TapRecognizer()
    expect(taps.end('a', 100, 1_000)).toBeNull()
    expect(taps.end('b', 100, 1_400)).toEqual({ kind: 'single', key: 'a' })
  })

  it('ignores holds longer than 350 ms', () => {
    const taps = new TapRecognizer()
    expect(taps.end('a', 351, 1_000)).toBeNull()
    expect(taps.end('a', 80, 1_100)).toBeNull()
    expect(taps.pendingSingle(2_000)).toBe('a')
  })

  it('applies a cooldown so a held pinch cannot fire taps', () => {
    const taps = new TapRecognizer()
    expect(taps.end('a', 100, 1_000)).toBeNull()
    expect(taps.end('b', 100, 1_100)).toBeNull()
  })

  it('reset clears a pending tap', () => {
    const taps = new TapRecognizer()
    taps.end('a', 100, 1_000)
    taps.reset()
    expect(taps.pendingSingle(2_000)).toBeNull()
  })

  it('rejects non-finite durations', () => {
    const taps = new TapRecognizer()
    expect(taps.end('a', Number.NaN, 1_000)).toBeNull()
    expect(taps.end('a', Number.POSITIVE_INFINITY, 1_000)).toBeNull()
  })
})
