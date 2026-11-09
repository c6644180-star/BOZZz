import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPOSER_IDLE_MS,
  ComposerIdleTimer,
  shouldCollapseComposer,
  shouldOpenComposerOnKey,
} from '../composer'

const OPEN_EMPTY = { open: true, focused: false, hasText: false }

describe('shouldCollapseComposer', () => {
  it('collapses an open, unfocused, empty bar', () => {
    expect(shouldCollapseComposer(OPEN_EMPTY)).toBe(true)
  })

  it('never collapses a closed bar', () => {
    expect(shouldCollapseComposer({ open: false, focused: false, hasText: false })).toBe(false)
  })

  it('never collapses while the field is focused', () => {
    expect(shouldCollapseComposer({ open: true, focused: true, hasText: false })).toBe(false)
  })

  it('never collapses while text is present', () => {
    expect(shouldCollapseComposer({ open: true, focused: false, hasText: true })).toBe(false)
  })
})

describe('ComposerIdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses after the idle window', () => {
    const onCollapse = vi.fn()
    const timer = new ComposerIdleTimer(onCollapse)

    timer.sync(OPEN_EMPTY)
    vi.advanceTimersByTime(COMPOSER_IDLE_MS - 1)
    expect(onCollapse).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onCollapse).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(COMPOSER_IDLE_MS * 2)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('does not start a timer while focused or while text exists', () => {
    const onCollapse = vi.fn()
    const timer = new ComposerIdleTimer(onCollapse)

    timer.sync({ open: true, focused: true, hasText: false })
    timer.sync({ open: true, focused: false, hasText: true })
    vi.advanceTimersByTime(COMPOSER_IDLE_MS * 3)

    expect(onCollapse).not.toHaveBeenCalled()
  })

  it('cancels the old timer when the state is re-synced', () => {
    const onCollapse = vi.fn()
    const timer = new ComposerIdleTimer(onCollapse)

    timer.sync(OPEN_EMPTY)
    vi.advanceTimersByTime(COMPOSER_IDLE_MS - 500)
    timer.sync({ open: true, focused: true, hasText: false })
    vi.advanceTimersByTime(COMPOSER_IDLE_MS * 2)
    expect(onCollapse).not.toHaveBeenCalled()

    timer.sync(OPEN_EMPTY)
    vi.advanceTimersByTime(COMPOSER_IDLE_MS)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('restarts the countdown on every sync instead of collapsing early', () => {
    const onCollapse = vi.fn()
    const timer = new ComposerIdleTimer(onCollapse)

    timer.sync(OPEN_EMPTY)
    vi.advanceTimersByTime(COMPOSER_IDLE_MS - 100)
    timer.sync(OPEN_EMPTY)
    vi.advanceTimersByTime(COMPOSER_IDLE_MS - 100)
    expect(onCollapse).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('dispose clears a pending collapse', () => {
    const onCollapse = vi.fn()
    const timer = new ComposerIdleTimer(onCollapse)

    timer.sync(OPEN_EMPTY)
    timer.dispose()
    vi.advanceTimersByTime(COMPOSER_IDLE_MS * 2)

    expect(onCollapse).not.toHaveBeenCalled()
  })
})

describe('shouldOpenComposerOnKey', () => {
  it('opens on a plain printable letter', () => {
    expect(shouldOpenComposerOnKey({ key: 'a', editable: false })).toBe(true)
    expect(shouldOpenComposerOnKey({ key: 'C', editable: false })).toBe(true)
    expect(shouldOpenComposerOnKey({ key: 'h', editable: false })).toBe(true)
    expect(shouldOpenComposerOnKey({ key: '7', editable: false })).toBe(true)
  })

  it('ignores keys while a field is already editable', () => {
    expect(shouldOpenComposerOnKey({ key: 'a', editable: true })).toBe(false)
  })

  it('ignores keys held with a modifier', () => {
    expect(shouldOpenComposerOnKey({ key: 'a', ctrlKey: true, editable: false })).toBe(false)
    expect(shouldOpenComposerOnKey({ key: 'a', metaKey: true, editable: false })).toBe(false)
    expect(shouldOpenComposerOnKey({ key: 'a', altKey: true, editable: false })).toBe(false)
  })

  it('keeps reserved keys for their own shortcuts', () => {
    expect(shouldOpenComposerOnKey({ key: '/', editable: false })).toBe(false)
    expect(shouldOpenComposerOnKey({ key: '?', editable: false })).toBe(false)
    expect(shouldOpenComposerOnKey({ key: ' ', editable: false })).toBe(false)
  })

  it('ignores non-printable keys', () => {
    expect(shouldOpenComposerOnKey({ key: 'Enter', editable: false })).toBe(false)
    expect(shouldOpenComposerOnKey({ key: 'Escape', editable: false })).toBe(false)
    expect(shouldOpenComposerOnKey({ key: 'ArrowLeft', editable: false })).toBe(false)
  })
})
