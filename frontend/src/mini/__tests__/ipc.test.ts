import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  isValidMode,
  sanitizeMiniAction,
  sanitizeMiniConfig,
  sanitizeMiniState,
} from '../../../electron/mini/ipc.cjs'

describe('isValidMode', () => {
  it('accepts only full and mini', () => {
    expect(isValidMode('full')).toBe(true)
    expect(isValidMode('mini')).toBe(true)
    expect(isValidMode('zoomed')).toBe(false)
    expect(isValidMode(null)).toBe(false)
    expect(isValidMode({ mode: 'mini' })).toBe(false)
  })
})

describe('sanitizeMiniState', () => {
  it('rejects anything that is not an object', () => {
    expect(sanitizeMiniState(null)).toBeNull()
    expect(sanitizeMiniState('mini')).toBeNull()
    expect(sanitizeMiniState([])).toBeNull()
  })

  it('binds every field to the allowed set', () => {
    const state = sanitizeMiniState({
      orbState: 'exploded',
      caption: 'x'.repeat(5000),
      listening: 'true',
      micAvailable: 1,
      cameraActive: true,
      desktopOn: true,
      emergency: true,
      approval: null,
    })
    expect(state).not.toBeNull()
    expect(state!.orbState).toBe('idle')
    expect(state!.caption).toHaveLength(600)
    expect(state!.listening).toBe(false)
    expect(state!.micAvailable).toBe(false)
    expect(state!.cameraActive).toBe(true)
    expect(state!.desktopOn).toBe(true)
    expect(state!.emergency).toBe(true)
    expect(state!.approval).toBeNull()
  })

  it('drops approvals with unsafe ids', () => {
    const state = sanitizeMiniState({ orbState: 'idle', approval: { id: '<script>', label: 'Launch' } })
    expect(state!.approval).toBeNull()
  })

  it('bounds a real approval payload', () => {
    const state = sanitizeMiniState({
      orbState: 'idle',
      approval: {
        id: 'approval_12-AB',
        label: 'Launch Calculator',
        tier: 9,
        source: 'voice',
        target: 'C:/Windows/System32/calc.exe',
        expiresInMs: 999999,
      },
    })
    expect(state!.approval).toEqual({
      id: 'approval_12-AB',
      label: 'Launch Calculator',
      tier: 3,
      source: 'voice',
      target: 'C:/Windows/System32/calc.exe',
      expiresInMs: 120000,
    })
  })
})

describe('sanitizeMiniAction', () => {
  it('rejects unknown actions and non-objects', () => {
    expect(sanitizeMiniAction(null)).toBeNull()
    expect(sanitizeMiniAction({ type: 'format-disk' })).toBeNull()
    expect(sanitizeMiniAction({ type: 42 })).toBeNull()
  })

  it('forces hover to a strict boolean', () => {
    expect(sanitizeMiniAction({ type: 'hover', value: true })).toEqual({ type: 'hover', value: true })
    expect(sanitizeMiniAction({ type: 'hover', value: 'yes' })).toEqual({ type: 'hover', value: false })
  })

  it('clamps drag coordinates to a plausible screen range', () => {
    expect(sanitizeMiniAction({ type: 'drag-move', screenX: 999999, screenY: -999999 })).toEqual({
      type: 'drag-move',
      screenX: 100000,
      screenY: -100000,
    })
    expect(sanitizeMiniAction({ type: 'drag-start', screenX: 'x', screenY: Number.NaN })).toEqual({
      type: 'drag-start',
      screenX: 0,
      screenY: 0,
    })
  })

  it('requires a valid approval id', () => {
    expect(sanitizeMiniAction({ type: 'approval', id: 'bad id', approve: true })).toBeNull()
    expect(sanitizeMiniAction({ type: 'approval', id: 'ok_1', approve: true })).toEqual({
      type: 'approval',
      id: 'ok_1',
      approve: true,
    })
    expect(sanitizeMiniAction({ type: 'approval', id: 'ok_1', approve: 'false' })).toEqual({
      type: 'approval',
      id: 'ok_1',
      approve: false,
    })
  })

  it('keeps the small command set intact', () => {
    for (const type of ['listen', 'mute', 'stop-speak', 'expand', 'quit', 'menu', 'emergency-stop', 'ptt-start', 'ptt-end']) {
      expect(sanitizeMiniAction({ type })).toEqual({ type })
    }
    expect(sanitizeMiniAction({ type: 'drag-end', moved: true })).toEqual({ type: 'drag-end', moved: true })
  })
})

describe('sanitizeMiniConfig', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeMiniConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(sanitizeMiniConfig('wat')).toEqual(DEFAULT_CONFIG)
  })

  it('clamps opacity and rejects unknown option values', () => {
    const config = sanitizeMiniConfig({
      opacity: 5,
      size: 'huge',
      wanderSpeed: 'ludicrous',
      dock: 'middle',
      monitor: 'left',
      theme: 'pink',
      pushToTalkKey: 'Enter',
    })
    expect(config.opacity).toBe(1)
    expect(config.size).toBe('small')
    expect(config.wanderSpeed).toBe('normal')
    expect(config.dock).toBe('free')
    expect(config.monitor).toBe('cursor')
    expect(config.theme).toBe('gold')
    expect(config.pushToTalkKey).toBe('Space')
    expect(sanitizeMiniConfig({ opacity: 0.1 }).opacity).toBe(0.35)
  })

  it('keeps valid choices', () => {
    const config = sanitizeMiniConfig({
      size: 'medium',
      opacity: 0.7,
      wander: false,
      wanderSpeed: 'slow',
      dock: 'bottom-right',
      monitor: 'primary',
      theme: 'cyan',
      reduceMotion: true,
      captions: false,
      pauseOnBattery: false,
      pushToTalk: false,
      pushToTalkKey: 'Control+Space',
    })
    expect(config).toEqual({
      size: 'medium',
      opacity: 0.7,
      wander: false,
      wanderSpeed: 'slow',
      dock: 'bottom-right',
      monitor: 'primary',
      theme: 'cyan',
      reduceMotion: true,
      captions: false,
      pauseOnBattery: false,
      pushToTalk: false,
      pushToTalkKey: 'Control+Space',
    })
  })
})
