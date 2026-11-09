import { describe, expect, it } from 'vitest'
import { isPanelOpen, togglePanel } from '../panels'

describe('togglePanel', () => {
  it('opens a panel when nothing is open', () => {
    expect(togglePanel(null, 'history')).toBe('history')
    expect(togglePanel(null, 'chat')).toBe('chat')
  })

  it('closes the panel when its own trigger is used again', () => {
    expect(togglePanel('history', 'history')).toBe(null)
    expect(togglePanel('chat', 'chat')).toBe(null)
    expect(togglePanel('menu', 'menu')).toBe(null)
  })

  it('replaces History with Chat so both are never open together', () => {
    const next = togglePanel('history', 'chat')
    expect(next).toBe('chat')
    expect(isPanelOpen(next, 'history')).toBe(false)
    expect(isPanelOpen(next, 'chat')).toBe(true)
  })

  it('replaces Chat with History', () => {
    const next = togglePanel('chat', 'history')
    expect(next).toBe('history')
    expect(isPanelOpen(next, 'chat')).toBe(false)
    expect(isPanelOpen(next, 'history')).toBe(true)
  })

  it('replaces any other panel with the requested one', () => {
    expect(togglePanel('menu', 'chat')).toBe('chat')
    expect(togglePanel('settings', 'history')).toBe('history')
    expect(togglePanel('desktop', 'menu')).toBe('menu')
  })
})

describe('isPanelOpen', () => {
  it('is true only for the active panel', () => {
    expect(isPanelOpen('chat', 'chat')).toBe(true)
    expect(isPanelOpen('history', 'chat')).toBe(false)
    expect(isPanelOpen(null, 'chat')).toBe(false)
  })
})
