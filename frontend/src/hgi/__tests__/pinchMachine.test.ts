import { describe, expect, it } from 'vitest'
import { PinchStateMachine } from '../state/PinchStateMachine'

function machine(overrides: Partial<ConstructorParameters<typeof PinchStateMachine>[0]> = {}) {
  return new PinchStateMachine({
    onThreshold: 0.3,
    offThreshold: 0.48,
    enterMs: 70,
    holdMs: 120,
    tapMaxMs: 260,
    lostMs: 200,
    cooldownMs: 260,
    minConfidence: 0.55,
    ...overrides,
  })
}

describe('PinchStateMachine', () => {
  it('waits for the enter window before starting a pinch', () => {
    const pinch = machine()
    const first = pinch.update(0.2, 0.9, 0)
    expect(first.justStarted).toBe(false)
    expect(first.pressed).toBe(false)
    expect(first.phase).toBe('hover')

    const tooSoon = pinch.update(0.2, 0.9, 40)
    expect(tooSoon.justStarted).toBe(false)

    const started = pinch.update(0.2, 0.9, 75)
    expect(started.justStarted).toBe(true)
    expect(started.pressed).toBe(true)
  })

  it('cancels a pending enter when the pinch opens again', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    const open = pinch.update(0.6, 0.9, 30)
    expect(open.justStarted).toBe(false)
    expect(pinch.update(0.2, 0.9, 80).justStarted).toBe(false)
    expect(pinch.update(0.2, 0.9, 160).justStarted).toBe(true)
  })

  it('confirms a hold after the configured minimum', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    const between = pinch.update(0.4, 0.9, 100)
    expect(between.pressed).toBe(true)
    expect(between.phase).toBe('pinch_start')
    const hold = pinch.update(0.4, 0.9, 200)
    expect(hold.justHeld).toBe(true)
    expect(hold.phase).toBe('pinch_hold')
  })

  it('uses hysteresis so a value between the thresholds keeps the pinch pressed', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    const output = pinch.update(0.47, 0.9, 90)
    expect(output.pressed).toBe(true)
    expect(output.justEnded).toBe(false)
  })

  it('allows a click only after the minimum hold and marks short releases as taps', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    const short = pinch.update(0.7, 0.9, 150)
    expect(short.justEnded).toBe(true)
    expect(short.clickAllowed).toBe(false)
    expect(short.shortPinch).toBe(true)
    expect(short.tap).toBe(true)
    expect(short.heldMs).toBe(80)

    const second = machine()
    second.update(0.2, 0.9, 0)
    second.update(0.2, 0.9, 70)
    second.update(0.2, 0.9, 250)
    const long = second.update(0.7, 0.9, 300)
    expect(long.clickAllowed).toBe(true)
    expect(long.shortPinch).toBe(false)
    expect(long.tap).toBe(false)
  })

  it('does not call a very long pinch a tap', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    const release = pinch.update(0.7, 0.9, 600)
    expect(release.tap).toBe(false)
    expect(release.clickAllowed).toBe(true)
  })

  it('blocks a new pinch during the cooldown', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    pinch.update(0.7, 0.9, 200)
    const tooSoon = pinch.update(0.2, 0.9, 300)
    expect(tooSoon.justStarted).toBe(false)
    const pending = pinch.update(0.2, 0.9, 500)
    expect(pending.justStarted).toBe(false)
    const later = pinch.update(0.2, 0.9, 575)
    expect(later.justStarted).toBe(true)
  })

  it('keeps a lost hand for 200 ms before ending the pinch', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    expect(pinch.lost(200)).toBeNull()
    const ended = pinch.lost(280)
    expect(ended?.justEnded).toBe(true)
    expect(ended?.clickAllowed).toBe(false)
    expect(ended?.tap).toBe(false)
    expect(pinch.isPressed).toBe(false)
  })

  it('never starts a pinch from an uncertain frame', () => {
    const pinch = machine()
    const output = pinch.update(0.1, 0.3, 0)
    expect(output.justStarted).toBe(false)
    expect(output.pressed).toBe(false)
  })

  it('resets cleanly', () => {
    const pinch = machine()
    pinch.update(0.2, 0.9, 0)
    pinch.update(0.2, 0.9, 70)
    pinch.reset()
    expect(pinch.isPressed).toBe(false)
    expect(pinch.update(0.2, 0.9, 1000).justStarted).toBe(false)
  })
})
