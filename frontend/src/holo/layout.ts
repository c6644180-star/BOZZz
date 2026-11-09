import type { FileEntry, FileKind } from '../services/files'

export const MAX_CHILDREN_PER_FOLDER = 60
export const MAX_VISIBLE_NODES = 300
export const NODE_SPACING = 1.6
export const BASE_RADIUS = 3
export const RADIAL_GAP = 2.8

export interface HoloNode {
  key: string
  path: string
  name: string
  type: 'folder' | 'file'
  kind: FileKind
  size: number
  modified: string
  openable: boolean
  blockedReason: string | null
  depth: number
  parentKey: string | null
  isMore: boolean
  hiddenCount: number
}

export interface LayoutNode {
  key: string
  depth: number
  angle: number
  radius: number
  x: number
  y: number
}

export interface BuildTreeOptions {
  filterImages?: boolean
}

function toNode(
  entry: FileEntry,
  depth: number,
  parentKey: string | null,
): HoloNode {
  return {
    key: entry.path,
    path: entry.path,
    name: entry.name,
    type: entry.type,
    kind: entry.kind,
    size: entry.size,
    modified: entry.modified,
    openable: entry.openable,
    blockedReason: entry.blocked_reason,
    depth,
    parentKey,
    isMore: false,
    hiddenCount: 0,
  }
}

/**
 * Depth-first flat tree of the nodes that are actually rendered. Children are
 * read lazily by the caller: a folder only contributes entries once it is in
 * ``expanded``. Caps are enforced here, not in the renderer.
 */
export function buildVisibleTree(
  root: FileEntry,
  childrenByPath: Readonly<Record<string, FileEntry[]>>,
  expanded: ReadonlySet<string>,
  options: BuildTreeOptions = {},
): HoloNode[] {
  const filterImages = options.filterImages === true
  const nodes: HoloNode[] = []

  function visit(entry: FileEntry, depth: number, parentKey: string | null): void {
    if (nodes.length >= MAX_VISIBLE_NODES) return
    nodes.push(toNode(entry, depth, parentKey))
    if (entry.type !== 'folder' || !expanded.has(entry.path)) return
    if (nodes.length >= MAX_VISIBLE_NODES) return

    const all = childrenByPath[entry.path] ?? []
    const filtered = filterImages
      ? all.filter((child) => child.type === 'folder' || child.kind === 'image')
      : all
    const visible = filtered.slice(0, MAX_CHILDREN_PER_FOLDER)
    for (const child of visible) {
      visit(child, depth + 1, entry.path)
      if (nodes.length >= MAX_VISIBLE_NODES) return
    }
    const hidden = filtered.length - visible.length
    if (hidden > 0 && nodes.length < MAX_VISIBLE_NODES) {
      nodes.push({
        key: `more:${entry.path}`,
        path: entry.path,
        name: `+${hidden} more`,
        type: 'file',
        kind: 'other',
        size: 0,
        modified: '',
        openable: false,
        blockedReason: null,
        depth: depth + 1,
        parentKey: entry.path,
        isMore: true,
        hiddenCount: hidden,
      })
    }
  }

  visit(root, 0, null)
  return nodes
}

/**
 * Deterministic radial layout: each folder owns an angular sector and its
 * children split that sector, so a child stays visually under its parent.
 * The ring radius grows until every sibling pair is at least NODE_SPACING
 * apart along the arc.
 */
export function layoutTree(nodes: HoloNode[]): LayoutNode[] {
  if (nodes.length === 0) return []
  const byDepth = new Map<number, HoloNode[]>()
  for (const node of nodes) {
    const level = byDepth.get(node.depth)
    if (level) level.push(node)
    else byDepth.set(node.depth, [node])
  }

  const positions = new Map<string, LayoutNode>()
  const sectors = new Map<string, { start: number; width: number }>()
  const root = nodes[0]
  positions.set(root.key, { key: root.key, depth: 0, angle: 0, radius: 0, x: 0, y: 0 })

  const firstLevel = byDepth.get(1) ?? []
  if (firstLevel.length > 0) {
    const width = (Math.PI * 2) / firstLevel.length
    const radius = Math.max(BASE_RADIUS, (firstLevel.length * NODE_SPACING) / (Math.PI * 2))
    const origin = -Math.PI / 2
    firstLevel.forEach((node, index) => {
      const start = origin + index * width
      sectors.set(node.key, { start, width })
      const angle = start + width / 2
      positions.set(node.key, {
        key: node.key,
        depth: 1,
        angle,
        radius,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      })
    })
  }

  const maxDepth = Math.max(0, ...byDepth.keys())
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    const level = byDepth.get(depth) ?? []
    const parents = byDepth.get(depth - 1) ?? []
    let neededRadius = 0
    const childSectors: Array<{ node: HoloNode; start: number; width: number }> = []

    for (const parent of parents) {
      const sector = sectors.get(parent.key)
      if (!sector) continue
      const children = level.filter((node) => node.parentKey === parent.key)
      if (children.length === 0) continue
      const width = sector.width / children.length
      if (children.length >= 2) {
        neededRadius = Math.max(neededRadius, NODE_SPACING / width)
      }
      children.forEach((child, index) => {
        const start = sector.start + index * width
        sectors.set(child.key, { start, width })
        childSectors.push({ node: child, start, width })
      })
    }

    const radius = Math.max(BASE_RADIUS + (depth - 1) * RADIAL_GAP, neededRadius)
    for (const item of childSectors) {
      const angle = item.start + item.width / 2
      positions.set(item.node.key, {
        key: item.node.key,
        depth,
        angle,
        radius,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      })
    }
  }

  return nodes.map((node) => positions.get(node.key)).filter((item): item is LayoutNode => Boolean(item))
}
