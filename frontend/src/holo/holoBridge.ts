import type { FileEntry } from '../services/files'

export interface PendingFolder {
  query: string
  label: string
  taskId: string
  matches: FileEntry[]
  note: string
}

interface HoloBridgeState {
  folder: PendingFolder | null
  revision: number
}

let state: HoloBridgeState = { folder: null, revision: 0 }
const listeners = new Set<() => void>()

function emit(): void {
  state = { ...state, revision: state.revision + 1 }
  listeners.forEach((listener) => listener())
}

export function subscribeHoloBridge(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getHoloBridge(): HoloBridgeState {
  return state
}

export function setPendingFolder(folder: PendingFolder): void {
  state = { ...state, folder }
  emit()
}

export function consumePendingFolder(): PendingFolder | null {
  const folder = state.folder
  if (folder) {
    state = { ...state, folder: null }
    emit()
  }
  return folder
}

export function navigateToHolo(): void {
  window.dispatchEvent(new CustomEvent('bozz:navigate', { detail: '/projects' }))
  window.dispatchEvent(new Event('bozz:holo-tab'))
}
