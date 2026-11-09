export interface UndoEntry {
  id: string
  label: string
  at: number
  undo: () => void
}

export class UndoStack {
  private entries: UndoEntry[] = []
  private counter = 0
  private listeners = new Set<() => void>()
  private limit: number

  constructor(limit = 30) {
    this.limit = limit
  }

  push(label: string, undo: () => void): string {
    this.counter += 1
    const id = `undo-${Date.now().toString(36)}-${this.counter}`
    this.entries.push({ id, label, at: Date.now(), undo })
    if (this.entries.length > this.limit) this.entries = this.entries.slice(-this.limit)
    this.emit()
    return id
  }

  pop(): UndoEntry | null {
    const entry = this.entries.pop() ?? null
    if (entry) this.emit()
    return entry
  }

  undoLast(): string | null {
    const entry = this.pop()
    if (!entry) return null
    try {
      entry.undo()
    } catch {
      // A failed undo leaves the action as it was; the caller still reports it.
    }
    return entry.label
  }

  canUndo(): boolean {
    return this.entries.length > 0
  }

  peek(): UndoEntry | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null
  }

  size(): number {
    return this.entries.length
  }

  clear(): void {
    this.entries = []
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const undoStack = new UndoStack()
