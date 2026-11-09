import { describe, expect, it } from 'vitest'
import { initialState, reduceMode } from '../../../electron/mini/state.cjs'

describe('mini mode state machine', () => {
  it('starts in full mode with every sensor off', () => {
    expect(initialState()).toEqual({ mode: 'full', micListening: false, cameraActive: false })
  })

  it('goes full → mini → full', () => {
    const full = initialState()
    const mini = reduceMode(full, { type: 'enter-mini' })
    expect(mini.mode).toBe('mini')
    const back = reduceMode(mini, { type: 'exit-mini' })
    expect(back.mode).toBe('full')
    expect(back).not.toBe(mini)
  })

  it('does not emit a new object when the mode is unchanged', () => {
    const full = initialState()
    expect(reduceMode(full, { type: 'exit-mini' })).toBe(full)
    const mini = reduceMode(full, { type: 'enter-mini' })
    expect(reduceMode(mini, { type: 'enter-mini' })).toBe(mini)
  })

  it('preserves microphone and camera indicators across mode switches', () => {
    let state = initialState()
    state = reduceMode(state, { type: 'mic', value: true })
    state = reduceMode(state, { type: 'camera', value: true })
    expect(state).toEqual({ mode: 'full', micListening: true, cameraActive: true })

    state = reduceMode(state, { type: 'enter-mini' })
    expect(state).toEqual({ mode: 'mini', micListening: true, cameraActive: true })

    state = reduceMode(state, { type: 'exit-mini' })
    expect(state).toEqual({ mode: 'full', micListening: true, cameraActive: true })
  })

  it('updates microphone and camera from real state messages', () => {
    const mini = reduceMode(initialState(), { type: 'enter-mini' })
    expect(reduceMode(mini, { type: 'mic', value: true }).micListening).toBe(true)
    expect(reduceMode(mini, { type: 'camera', value: true }).cameraActive).toBe(true)
    expect(reduceMode(mini, { type: 'mic', value: false }).micListening).toBe(false)
  })

  it('ignores malformed events and non-boolean sensor values', () => {
    const state = { mode: 'mini' as const, micListening: true, cameraActive: false }
    expect(reduceMode(state, null)).toBe(state)
    expect(reduceMode(state, { type: 'mic', value: 'yes' })).toBe(state)
    expect(reduceMode(state, { type: 'camera', value: 1 })).toBe(state)
    expect(reduceMode(state, { type: 'unknown' })).toBe(state)
  })

  it('recovers from a corrupted state object', () => {
    const broken = { mode: 'zoomed', micListening: true, cameraActive: true } as unknown as ReturnType<typeof initialState>
    const next = reduceMode(broken, { type: 'enter-mini' })
    expect(next.mode).toBe('mini')
    expect(next.micListening).toBe(false)
    expect(next.cameraActive).toBe(false)
  })
})
