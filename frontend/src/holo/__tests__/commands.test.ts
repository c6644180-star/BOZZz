import { describe, expect, it } from 'vitest'
import { cleanFolderQuery, parseHoloCommand } from '../commands'

describe('parseHoloCommand', () => {
  it('recognises requests to show the workspace', () => {
    expect(parseHoloCommand('show holographic projects', false)).toEqual({ kind: 'show' })
    expect(parseHoloCommand('open the hologram', false)).toEqual({ kind: 'show' })
    expect(parseHoloCommand('go to holo workspace', false)).toEqual({ kind: 'show' })
  })

  it('turns a spoken folder name into a folder search, not an open', () => {
    expect(parseHoloCommand('open my engineering folder', false)).toEqual({
      kind: 'open-folder',
      query: 'engineering',
      label: 'folder engineering',
    })
    expect(parseHoloCommand('open the design folders', false)).toEqual({
      kind: 'open-folder',
      query: 'design',
      label: 'folder design',
    })
    expect(parseHoloCommand('open folder lab', false)).toEqual({
      kind: 'open-folder',
      query: 'lab',
      label: 'folder lab',
    })
  })

  it('parses workspace controls', () => {
    expect(parseHoloCommand('expand src folder', true)).toEqual({ kind: 'expand', name: 'src' })
    expect(parseHoloCommand('collapse', true)).toEqual({ kind: 'collapse' })
    expect(parseHoloCommand('collapse the src node', true)).toEqual({ kind: 'collapse', name: 'src' })
    expect(parseHoloCommand('go back', true)).toEqual({ kind: 'back' })
    expect(parseHoloCommand('up one level', true)).toEqual({ kind: 'back' })
    expect(parseHoloCommand('reset view', true)).toEqual({ kind: 'reset' })
    expect(parseHoloCommand('zoom in', true)).toEqual({ kind: 'zoom', factor: 1.2 })
    expect(parseHoloCommand('zoom out', true)).toEqual({ kind: 'zoom', factor: 0.8 })
  })

  it('parses the image filter both ways', () => {
    expect(parseHoloCommand('show only images', true)).toEqual({ kind: 'filter', on: true })
    expect(parseHoloCommand('show all files', true)).toEqual({ kind: 'filter', on: false })
    expect(parseHoloCommand('clear the filter', true)).toEqual({ kind: 'filter', on: false })
  })

  it('only treats "open <name>" as a node open while the scene is running', () => {
    expect(parseHoloCommand('open notes.txt', true)).toEqual({ kind: 'open', name: 'notes.txt' })
    expect(parseHoloCommand('open notes.txt', false)).toBeNull()
  })

  it('ignores unrelated speech', () => {
    expect(parseHoloCommand('what is the weather', true)).toBeNull()
    expect(parseHoloCommand('   ', true)).toBeNull()
  })
})

describe('cleanFolderQuery', () => {
  it('removes filler words and trailing punctuation', () => {
    expect(cleanFolderQuery('my Engineering folder.')).toBe('Engineering')
    expect(cleanFolderQuery('the lab folders please')).toBe('lab')
  })
})
