import { describe, expect, it } from 'vitest'
import {
  IDLE_LIMIT_SECONDS,
  computePauseReasons,
  shouldPauseAnimation,
  shouldPauseWander,
} from '../../../electron/mini/pause.cjs'

const IDLE = { wanderEnabled: true, idleSeconds: 0 }

describe('computePauseReasons', () => {
  it('returns no reasons when the user is active', () => {
    expect(computePauseReasons(IDLE)).toEqual([])
  })

  it('reports each independent reason', () => {
    expect(computePauseReasons({ ...IDLE, wanderEnabled: false })).toEqual(['wander-off'])
    expect(computePauseReasons({ ...IDLE, manualPause: true })).toEqual(['manual-pause'])
    expect(computePauseReasons({ ...IDLE, approvalPending: true })).toEqual(['approval'])
    expect(computePauseReasons({ ...IDLE, fullscreen: true })).toEqual(['fullscreen'])
    expect(computePauseReasons({ ...IDLE, onBattery: true })).toEqual(['battery'])
  })

  it('honours the pause-on-battery setting', () => {
    expect(computePauseReasons({ ...IDLE, onBattery: true, pauseOnBattery: false })).toEqual([])
    expect(computePauseReasons({ ...IDLE, onBattery: true, pauseOnBattery: true })).toEqual(['battery'])
  })

  it('pauses after the idle limit', () => {
    expect(computePauseReasons({ ...IDLE, idleSeconds: IDLE_LIMIT_SECONDS - 1 })).toEqual([])
    expect(computePauseReasons({ ...IDLE, idleSeconds: IDLE_LIMIT_SECONDS })).toEqual(['idle'])
    expect(computePauseReasons({ ...IDLE, idleSeconds: 12, idleLimitSeconds: 10 })).toEqual(['idle'])
  })

  it('does not treat speaking or listening as idle', () => {
    expect(computePauseReasons({ ...IDLE, idleSeconds: 9999, busy: true })).toEqual([])
  })

  it('combines reasons in a stable order', () => {
    expect(
      computePauseReasons({
        wanderEnabled: false,
        manualPause: true,
        approvalPending: true,
        fullscreen: true,
        onBattery: true,
        idleSeconds: 500,
        pauseOnBattery: true,
      }),
    ).toEqual(['wander-off', 'manual-pause', 'approval', 'fullscreen', 'battery', 'idle'])
  })

  it('tolerates missing or malformed input', () => {
    expect(computePauseReasons(null)).toEqual([])
    expect(computePauseReasons({ wanderEnabled: true, idleSeconds: 'soon' })).toEqual([])
  })
})

describe('pause policy', () => {
  it('freezes animation only for idle, battery and fullscreen', () => {
    expect(shouldPauseAnimation(['idle'])).toBe(true)
    expect(shouldPauseAnimation(['battery'])).toBe(true)
    expect(shouldPauseAnimation(['fullscreen'])).toBe(true)
    expect(shouldPauseAnimation(['wander-off'])).toBe(false)
    expect(shouldPauseAnimation(['manual-pause', 'approval'])).toBe(false)
    expect(shouldPauseAnimation([])).toBe(false)
    expect(shouldPauseAnimation(null)).toBe(false)
  })

  it('stops wandering for every reason', () => {
    expect(shouldPauseWander([])).toBe(false)
    expect(shouldPauseWander(['approval'])).toBe(true)
    expect(shouldPauseWander(['manual-pause'])).toBe(true)
    expect(shouldPauseWander(null)).toBe(false)
  })
})
