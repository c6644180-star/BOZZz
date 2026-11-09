import type { FileEntry, FileKind, SpatialLayoutCard } from '../services/files'

export const MAX_VISIBLE_CARDS = 100
const DEFAULT_WIDTH = 260
const DEFAULT_HEIGHT = 190
const MIN_WIDTH = 170
const MIN_HEIGHT = 130

export interface SpatialCard {
  id: string
  path: string
  name: string
  type: 'file' | 'folder'
  kind: FileKind
  size: number
  modified: string
  openable: boolean
  blockedReason: string | null
  x: number
  y: number
  w: number
  h: number
  z: number
  group?: string
  missing: boolean
  missingReason?: string
}

export interface SpatialState {
  cards: SpatialCard[]
  selected: string[]
  dismissed: SpatialCard[]
  revision: number
  limitReached: boolean
  clearedCount: number
}

function cardId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function nextPosition(index: number): { x: number; y: number } {
  const column = index % 5
  const row = Math.floor(index / 5) % 4
  return { x: 36 + column * 34 + row * 18, y: 34 + row * 30 + column * 14 }
}

function sanitizeLayoutCard(item: SpatialLayoutCard): SpatialCard | null {
  if (!item || typeof item.path !== 'string' || !item.path.trim()) return null
  const name = (item.name || item.path.split(/[\\/]/).pop() || item.path).slice(0, 255)
  return {
    id: cardId(),
    path: item.path,
    name,
    type: 'file',
    kind: 'other',
    size: 0,
    modified: '',
    openable: true,
    blockedReason: null,
    x: Number.isFinite(item.x) ? Math.max(0, item.x) : 40,
    y: Number.isFinite(item.y) ? Math.max(0, item.y) : 40,
    w: Number.isFinite(item.w) ? Math.max(MIN_WIDTH, item.w) : DEFAULT_WIDTH,
    h: Number.isFinite(item.h) ? Math.max(MIN_HEIGHT, item.h) : DEFAULT_HEIGHT,
    z: Number.isFinite(item.z) ? item.z : 1,
    group: item.group,
    missing: false,
  }
}

export function cardFromEntry(entry: FileEntry, index = 0, z = 1): SpatialCard {
  const position = nextPosition(index)
  return {
    id: cardId(),
    path: entry.path,
    name: entry.name,
    type: entry.type,
    kind: entry.kind,
    size: entry.size,
    modified: entry.modified,
    openable: entry.openable,
    blockedReason: entry.blocked_reason,
    x: position.x,
    y: position.y,
    w: DEFAULT_WIDTH,
    h: DEFAULT_HEIGHT,
    z,
    missing: false,
  }
}

export function toLayoutCard(card: SpatialCard): SpatialLayoutCard {
  return {
    id: card.id,
    path: card.path,
    name: card.name,
    x: Math.round(card.x),
    y: Math.round(card.y),
    w: Math.round(card.w),
    h: Math.round(card.h),
    z: Math.round(card.z),
    ...(card.group ? { group: card.group } : {}),
  }
}

export class SpatialController {
  private state: SpatialState = {
    cards: [],
    selected: [],
    dismissed: [],
    revision: 0,
    limitReached: false,
    clearedCount: 0,
  }
  private listeners = new Set<() => void>()
  private openHandler: ((card: SpatialCard) => void) | null = null
  private undoStack: SpatialCard[][] = []
  private cleared: SpatialCard[] = []

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SpatialState => this.state

  private emit(next: Partial<SpatialState>): void {
    this.state = { ...this.state, ...next, revision: this.state.revision + 1 }
    this.listeners.forEach((listener) => listener())
  }

  bindOpen(handler: ((card: SpatialCard) => void) | null): void {
    this.openHandler = handler
  }

  cards(): SpatialCard[] {
    return this.state.cards
  }

  selectedCards(): SpatialCard[] {
    return this.state.cards.filter((card) => this.state.selected.includes(card.id))
  }

  setMissing(id: string, missing: boolean, reason?: string): void {
    const card = this.state.cards.find((item) => item.id === id)
    if (!card || (card.missing === missing && card.missingReason === reason)) return
    this.emit({
      cards: this.state.cards.map((item) =>
        item.id === id ? { ...item, missing, missingReason: reason } : item,
      ),
    })
  }

  updateMeta(
    id: string,
    patch: Partial<Pick<SpatialCard, 'kind' | 'size' | 'modified' | 'openable' | 'blockedReason' | 'type' | 'missing' | 'missingReason'>>,
  ): void {
    const card = this.state.cards.find((item) => item.id === id)
    if (!card) return
    const changed = (Object.keys(patch) as Array<keyof typeof patch>).some((key) => card[key] !== patch[key])
    if (!changed) return
    this.emit({
      cards: this.state.cards.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })
  }

  add(entry: FileEntry): SpatialCard | null {
    const existing = this.state.cards.find((card) => card.path === entry.path)
    if (existing) {
      this.select(existing.id)
      return existing
    }
    if (this.state.cards.length >= MAX_VISIBLE_CARDS) {
      if (!this.state.limitReached) this.emit({ limitReached: true })
      return null
    }
    const z = this.state.cards.reduce((max, card) => Math.max(max, card.z), 0) + 1
    const card = cardFromEntry(entry, this.state.cards.length, z)
    this.emit({
      cards: [...this.state.cards, card],
      dismissed: this.state.dismissed.filter((item) => item.path !== entry.path),
      selected: [card.id],
      limitReached: this.state.cards.length + 1 >= MAX_VISIBLE_CARDS,
    })
    return card
  }

  addMany(entries: FileEntry[]): number {
    let added = 0
    for (const entry of entries) {
      if (this.add(entry)) added += 1
    }
    return added
  }

  load(cards: SpatialCard[]): void {
    const unique = new Map<string, SpatialCard>()
    for (const card of cards) {
      if (unique.size >= MAX_VISIBLE_CARDS) break
      if (!unique.has(card.path)) unique.set(card.path, card)
    }
    this.cleared = []
    this.undoStack = []
    this.emit({
      cards: [...unique.values()],
      selected: [],
      dismissed: [],
      limitReached: cards.length > MAX_VISIBLE_CARDS,
      clearedCount: 0,
    })
  }

  select(id: string, additive = false): void {
    if (!this.state.cards.some((card) => card.id === id)) return
    const selected = additive
      ? this.state.selected.includes(id)
        ? this.state.selected.filter((item) => item !== id)
        : [...this.state.selected, id]
      : [id]
    this.emit({ selected })
  }

  selectMany(ids: string[], additive = false): void {
    const valid = ids.filter((id) => this.state.cards.some((card) => card.id === id))
    const selected = additive
      ? Array.from(new Set([...this.state.selected, ...valid]))
      : valid
    this.emit({ selected })
  }

  clearSelection(): void {
    if (this.state.selected.length) this.emit({ selected: [] })
  }

  move(id: string, x: number, y: number): void {
    const card = this.state.cards.find((item) => item.id === id)
    if (!card) return
    const nextX = Math.max(0, Math.round(x))
    const nextY = Math.max(0, Math.round(y))
    if (card.x === nextX && card.y === nextY) return
    this.emit({
      cards: this.state.cards.map((item) =>
        item.id === id ? { ...item, x: nextX, y: nextY } : item,
      ),
    })
  }

  moveSelected(dx: number, dy: number): void {
    if (!dx && !dy) return
    const ids = new Set(this.state.selected)
    if (!ids.size) return
    this.emit({
      cards: this.state.cards.map((card) =>
        ids.has(card.id)
          ? { ...card, x: Math.max(0, Math.round(card.x + dx)), y: Math.max(0, Math.round(card.y + dy)) }
          : card,
      ),
    })
  }

  resize(id: string, w: number, h: number): void {
    const card = this.state.cards.find((item) => item.id === id)
    if (!card) return
    const nextW = Math.max(MIN_WIDTH, Math.round(w))
    const nextH = Math.max(MIN_HEIGHT, Math.round(h))
    if (card.w === nextW && card.h === nextH) return
    this.emit({
      cards: this.state.cards.map((item) =>
        item.id === id ? { ...item, w: nextW, h: nextH } : item,
      ),
    })
  }

  open(id: string): void {
    const card = this.state.cards.find((item) => item.id === id)
    if (!card) return
    if (card.missing) return
    this.openHandler?.(card)
  }

  group(ids: string[], group: string): void {
    const label = group.trim().slice(0, 120)
    if (!label) return
    const targets = new Set(ids)
    this.emit({
      cards: this.state.cards.map((card) =>
        targets.has(card.id) ? { ...card, group: label } : card,
      ),
    })
  }

  ungroup(ids: string[]): void {
    const targets = new Set(ids)
    this.emit({
      cards: this.state.cards.map((card) => {
        if (!targets.has(card.id)) return card
        const next = { ...card }
        delete next.group
        return next
      }),
    })
  }

  dismiss(ids: string[]): SpatialCard[] {
    const targets = new Set(ids)
    const removed = this.state.cards.filter((card) => targets.has(card.id))
    if (!removed.length) return []
    this.undoStack.push(removed)
    this.emit({
      cards: this.state.cards.filter((card) => !targets.has(card.id)),
      selected: this.state.selected.filter((id) => !targets.has(id)),
      dismissed: [...removed, ...this.state.dismissed],
    })
    return removed
  }

  restoreLast(): SpatialCard | null {
    const group = this.undoStack.pop()
    if (!group?.length) return null
    this.restoreIds(group.map((card) => card.id))
    return group[0]
  }

  restore(id: string): SpatialCard | null {
    const card = this.state.dismissed.find((item) => item.id === id)
    if (!card) return null
    this.restoreIds([id])
    return card
  }

  restoreIds(ids: string[]): void {
    const targets = new Set(ids)
    const restored = this.state.dismissed.filter((card) => targets.has(card.id))
    if (!restored.length) return
    const existing = new Set(this.state.cards.map((card) => card.path))
    const fresh = restored
      .filter((card) => !existing.has(card.path))
      .slice(0, Math.max(0, MAX_VISIBLE_CARDS - this.state.cards.length))
    this.emit({
      cards: [...this.state.cards, ...fresh],
      dismissed: this.state.dismissed.filter((card) => !targets.has(card.id)),
      selected: fresh.map((card) => card.id),
      limitReached: fresh.length < restored.length || this.state.cards.length + fresh.length >= MAX_VISIBLE_CARDS,
    })
  }

  clearAll(): number {
    if (!this.state.cards.length) return 0
    const count = this.state.cards.length
    this.cleared = this.state.cards
    this.emit({
      cards: [],
      selected: [],
      dismissed: [],
      clearedCount: count,
      limitReached: false,
    })
    return count
  }

  restoreCleared(): SpatialCard[] {
    const restored = this.cleared.slice(0, MAX_VISIBLE_CARDS)
    if (!restored.length) return []
    this.cleared = []
    this.emit({ cards: restored, selected: [], clearedCount: 0 })
    return restored
  }

  layoutCards(): SpatialLayoutCard[] {
    return this.state.cards.map(toLayoutCard)
  }

  applyLayout(layoutCards: SpatialLayoutCard[]): number {
    const cards = layoutCards
      .map(sanitizeLayoutCard)
      .filter((card): card is SpatialCard => card !== null)
      .slice(0, MAX_VISIBLE_CARDS)
    this.load(cards)
    return cards.length
  }
}

let activeController: SpatialController | null = null

export function registerSpatialController(controller: SpatialController): () => void {
  activeController = controller
  return () => {
    if (activeController === controller) activeController = null
  }
}

export function getSpatialController(): SpatialController | null {
  return activeController
}

/** Input adapters (pointer, keyboard, or the existing gesture event bus later)
 * only need to call these controller methods. No gesture code lives here. */
export interface SpatialInputAdapter {
  name: string
  attach(controller: SpatialController): () => void
}
