import type { FileEntry } from '../services/files'
import type { IntentView } from '../services/intent'

export interface PendingFind {
  query: string
  label: string
  mode: 'find' | 'open'
  taskId: string
  matches: FileEntry[]
  note: string
}

interface BridgeState {
  find: PendingFind | null
  open: IntentView | null
  revision: number
}

let state: BridgeState = { find: null, open: null, revision: 0 }
const listeners = new Set<() => void>()

function emit(): void {
  state = { ...state, revision: state.revision + 1 }
  listeners.forEach((listener) => listener())
}

export function subscribeSpatialBridge(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSpatialBridge(): BridgeState {
  return state
}

export function setPendingFind(find: PendingFind): void {
  state = { ...state, find }
  emit()
}

export function consumePendingFind(): PendingFind | null {
  const find = state.find
  if (find) {
    state = { ...state, find: null }
    emit()
  }
  return find
}

export function setPendingOpen(intent: IntentView): void {
  state = { ...state, open: intent }
  emit()
}

export function consumePendingOpen(): IntentView | null {
  const intent = state.open
  if (intent) {
    state = { ...state, open: null }
    emit()
  }
  return intent
}

export function navigateToSpatial(): void {
  window.dispatchEvent(new CustomEvent('bozz:navigate', { detail: '/spatial' }))
}
