import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AgentBanner } from '../agent/AgentBanner'
import { AgentPanel } from '../agent/AgentPanel'
import { AgentProvider } from '../agent/AgentProvider'
import { ErrorBoundary } from '../components/ErrorBoundary'
import MemoryPage from '../pages/MemoryPage'

// These catch "the screen crashes the moment it renders", the failure that blanks the app.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
})

describe('screens render without crashing', () => {
  it('computer agent panel and banner', () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        null,
        createElement(AgentProvider, null, createElement(AgentBanner), createElement(AgentPanel)),
      ),
    )
    expect(html.length).toBeGreaterThan(100)
  })

  it('memory page', () => {
    expect(renderToString(createElement(MemoryPage))).toContain('Memory')
  })

  it('error boundary shows a fallback instead of a blank page', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
    expect(state.error?.message).toBe('boom')
    expect(renderToString(createElement(ErrorBoundary, null, 'ok'))).toContain('ok')
  })
})
