import { describe, expect, it, vi } from 'vitest'
import { parseAppCommand, runAppCommand } from '../appCommands'

describe('parseAppCommand: opening screens and panels', () => {
  it('opens real pages by many phrasings', () => {
    expect(parseAppCommand('open the 3D viewer')).toMatchObject({ kind: 'navigate', path: '/3d' })
    expect(parseAppCommand('BOZZ, take me to gesture lab')).toMatchObject({ kind: 'navigate', path: '/gesture' })
    expect(parseAppCommand('show my memory page')).toMatchObject({ kind: 'navigate', path: '/memory' })
    expect(parseAppCommand('Please open the Spatial Desktop.')).toMatchObject({ kind: 'navigate', path: '/spatial' })
    expect(parseAppCommand('open the device hub')).toMatchObject({ kind: 'navigate', path: '/devices-hub' })
  })

  it('opens panels instead of pages for chat, settings, tools and agent', () => {
    expect(parseAppCommand('open chat')).toMatchObject({ kind: 'panel', event: 'bozz:open-chat' })
    expect(parseAppCommand('open settings')).toMatchObject({ kind: 'panel', event: 'bozz:open-settings' })
    expect(parseAppCommand('open the tools')).toMatchObject({ kind: 'panel', event: 'bozz:open-menu' })
    expect(parseAppCommand('open the computer agent')).toMatchObject({ kind: 'panel', event: 'bozz:open-agent' })
    expect(parseAppCommand('open chat page')).toMatchObject({ kind: 'navigate', path: '/chat' })
  })

  it('is honest about screens that are not built', () => {
    expect(parseAppCommand('open the market analyzer')).toMatchObject({ kind: 'planned', label: 'Market Analyzer' })
    expect(parseAppCommand('open health')).toMatchObject({ kind: 'planned' })
  })

  it('ignores ordinary conversation', () => {
    expect(parseAppCommand('what is the capital of France')).toBeNull()
    expect(parseAppCommand('open the pod bay doors')).toBeNull()
    expect(parseAppCommand('')).toBeNull()
  })
})

describe('parseAppCommand: gestures and agent', () => {
  it('controls gestures', () => {
    expect(parseAppCommand('turn on hand tracking')).toEqual({ kind: 'gesture', action: 'start' })
    expect(parseAppCommand('stop gesture control')).toEqual({ kind: 'gesture', action: 'stop' })
    expect(parseAppCommand('switch to cursor mode')).toEqual({ kind: 'gesture-mode', mode: 'cursor' })
    expect(parseAppCommand('use orb mode')).toEqual({ kind: 'gesture-mode', mode: 'orb' })
  })

  it('never switches real desktop control on by voice', () => {
    expect(parseAppCommand('switch to desktop mode')).toEqual({ kind: 'gesture-desktop-refused' })
  })

  it('hands tasks to the agent only on an explicit phrase', () => {
    expect(parseAppCommand('ask the agent to open the test site and search for A2D')).toMatchObject({ kind: 'agent' })
    expect(parseAppCommand('agent: find the newest video')).toMatchObject({ kind: 'agent' })
    expect(parseAppCommand('do you know about agents')).toBeNull()
  })

  it('keeps the original casing of the agent task', () => {
    const command = parseAppCommand('Ask the agent to search for A2D on the Test Site')
    expect(command).toMatchObject({ kind: 'agent', task: 'search for A2D on the Test Site' })
  })
})

describe('runAppCommand', () => {
  it('dispatches events for navigation and gestures', async () => {
    const dispatch = vi.fn()
    expect((await runAppCommand('open the 3d viewer', { dispatch }))?.reply).toMatch(/3D viewer/)
    expect(dispatch).toHaveBeenCalledWith('bozz:navigate', '/3d')
    await runAppCommand('start gestures', { dispatch })
    expect(dispatch).toHaveBeenCalledWith('bozz:gesture-command', { action: 'start' })
  })

  it('starts the agent through its event so the approval flow still applies', async () => {
    const dispatch = vi.fn()
    const result = await runAppCommand('ask the agent to search the test site for A2D', { dispatch })
    expect(result?.reply).toMatch(/Review its plan/)
    expect(dispatch).toHaveBeenCalledWith('bozz:agent-start', { task: 'search the test site for A2D' })
  })

  it('stores, lists and forgets memory through the API', async () => {
    const addMemory = vi.fn().mockResolvedValue({})
    const listMemory = vi.fn().mockResolvedValue([{ text: 'I prefer short answers' }])
    const forgetMemory = vi.fn().mockResolvedValue(1)
    const dispatch = vi.fn()
    expect((await runAppCommand('remember that I prefer short answers', { addMemory, dispatch }))?.reply).toMatch(/remember/)
    expect(addMemory).toHaveBeenCalledWith('I prefer short answers', 'voice')
    expect((await runAppCommand('what do you remember about me', { listMemory, dispatch }))?.reply).toContain('short answers')
    expect((await runAppCommand('forget short answers', { listMemory, forgetMemory, dispatch }))?.reply).toBe('Forgotten.')
    expect(forgetMemory).toHaveBeenCalledWith('short answers')
  })

  it('refuses vague or large forgets', async () => {
    const forgetMemory = vi.fn()
    const listMemory = vi.fn().mockResolvedValue([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }])
    expect((await runAppCommand('forget it', { listMemory, forgetMemory }))?.reply).toMatch(/exactly/)
    expect((await runAppCommand('forget everything about tea', { listMemory, forgetMemory }))?.reply).toMatch(/Memory page/)
    expect(forgetMemory).not.toHaveBeenCalled()
  })

  it('explains when memory is switched off', async () => {
    const addMemory = vi.fn().mockRejectedValue(Object.assign(new Error('off'), { status: 403 }))
    expect((await runAppCommand('remember that I like tea', { addMemory }))?.reply).toMatch(/switched off/)
  })

  it('answers the wake word', async () => {
    expect((await runAppCommand('BOZZ'))?.reply).toMatch(/here/)
  })
})
