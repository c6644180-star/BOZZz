import { describe, expect, it } from 'vitest'
import type { FileEntry, FileKind } from '../../services/files'
import {
  BASE_RADIUS,
  MAX_CHILDREN_PER_FOLDER,
  MAX_VISIBLE_NODES,
  NODE_SPACING,
  buildVisibleTree,
  layoutTree,
} from '../layout'

function file(path: string, name: string, kind: FileKind = 'text'): FileEntry {
  return {
    name,
    path,
    type: 'file',
    kind,
    size: 12,
    modified: '2026-01-01T00:00:00Z',
    openable: true,
    blocked_reason: null,
  }
}

function folder(path: string, name: string): FileEntry {
  return {
    name,
    path,
    type: 'folder',
    kind: 'folder',
    size: 0,
    modified: '2026-01-01T00:00:00Z',
    openable: false,
    blocked_reason: null,
  }
}

const root = folder('C:\\lab', 'lab')

describe('buildVisibleTree', () => {
  it('only expands folders that are marked expanded', () => {
    const children = { 'C:\\lab': [folder('C:\\lab\\src', 'src'), file('C:\\lab\\notes.txt', 'notes.txt')] }
    const collapsed = buildVisibleTree(root, children, new Set())
    expect(collapsed.map((node) => node.name)).toEqual(['lab'])

    const expanded = buildVisibleTree(root, children, new Set(['C:\\lab']))
    expect(expanded.map((node) => node.name)).toEqual(['lab', 'src', 'notes.txt'])
    expect(expanded[1].depth).toBe(1)
    expect(expanded[1].parentKey).toBe('C:\\lab')
  })

  it(`caps one folder at ${MAX_CHILDREN_PER_FOLDER} children plus a "+N more" node`, () => {
    const extra = 12
    const children = Array.from({ length: MAX_CHILDREN_PER_FOLDER + extra }, (_, index) =>
      file(`C:\\lab\\file-${index}.txt`, `file-${index}.txt`),
    )
    const nodes = buildVisibleTree(root, { 'C:\\lab': children }, new Set(['C:\\lab']))
    const more = nodes.filter((node) => node.isMore)

    expect(nodes).toHaveLength(1 + MAX_CHILDREN_PER_FOLDER + 1)
    expect(more).toHaveLength(1)
    expect(more[0].name).toBe(`+${extra} more`)
    expect(more[0].hiddenCount).toBe(extra)
    expect(more[0].key).toBe('more:C:\\lab')
  })

  it(`never renders more than ${MAX_VISIBLE_NODES} nodes`, () => {
    const children: Record<string, FileEntry[]> = {}
    const top = Array.from({ length: MAX_CHILDREN_PER_FOLDER }, (_, index) => {
      const path = `C:\\lab\\dir-${index}`
      children[path] = Array.from({ length: MAX_CHILDREN_PER_FOLDER }, (_, child) =>
        file(`${path}\\f-${child}.txt`, `f-${child}.txt`),
      )
      return folder(path, `dir-${index}`)
    })
    children['C:\\lab'] = top
    const expanded = new Set(Object.keys(children))
    const nodes = buildVisibleTree(root, children, expanded)

    expect(nodes).toHaveLength(MAX_VISIBLE_NODES)
    expect(new Set(nodes.map((node) => node.key)).size).toBe(nodes.length)
  })

  it('keeps folders and images only when the image filter is on', () => {
    const children = {
      'C:\\lab': [
        folder('C:\\lab\\src', 'src'),
        file('C:\\lab\\a.png', 'a.png', 'image'),
        file('C:\\lab\\b.txt', 'b.txt', 'text'),
      ],
    }
    const nodes = buildVisibleTree(root, children, new Set(['C:\\lab']), { filterImages: true })
    expect(nodes.map((node) => node.name)).toEqual(['lab', 'src', 'a.png'])
  })
})

describe('layoutTree', () => {
  it('places every node and keeps nodes apart', () => {
    const children = {
      'C:\\lab': [
        folder('C:\\lab\\src', 'src'),
        folder('C:\\lab\\art', 'art'),
        file('C:\\lab\\notes.txt', 'notes.txt'),
      ],
      'C:\\lab\\src': [
        file('C:\\lab\\src\\a.ts', 'a.ts'),
        file('C:\\lab\\src\\b.ts', 'b.ts'),
        file('C:\\lab\\src\\c.ts', 'c.ts'),
      ],
    }
    const nodes = buildVisibleTree(root, children, new Set(['C:\\lab', 'C:\\lab\\src']))
    const layout = layoutTree(nodes)

    expect(layout).toHaveLength(nodes.length)
    expect(layout[0]).toMatchObject({ x: 0, y: 0 })

    for (let a = 0; a < layout.length; a += 1) {
      for (let b = a + 1; b < layout.length; b += 1) {
        const distance = Math.hypot(layout[a].x - layout[b].x, layout[a].y - layout[b].y)
        expect(distance).toBeGreaterThanOrEqual(NODE_SPACING * 0.9)
      }
    }
    const firstRing = layout.filter((node) => node.depth === 1)
    expect(firstRing.every((node) => node.radius >= BASE_RADIUS)).toBe(true)
  })

  it('is deterministic for the same tree', () => {
    const children = { 'C:\\lab': [folder('C:\\lab\\src', 'src'), file('C:\\lab\\a.txt', 'a.txt')] }
    const nodes = buildVisibleTree(root, children, new Set(['C:\\lab']))
    expect(layoutTree(nodes)).toEqual(layoutTree(nodes))
  })
})
