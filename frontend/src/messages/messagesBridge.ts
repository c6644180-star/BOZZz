import type { ActionEnvelope } from './types'

interface BciBridgeState {
  selectedConversationId: string | null
  pendingAction: ActionEnvelope | null
  revision: number
}

let state: BciBridgeState = { selectedConversationId: null, pendingAction: null, revision: 0 }
const listeners = new Set<() => void>()

function emit(): void {
  state = { ...state, revision: state.revision + 1 }
  listeners.forEach((listener) => listener())
}

export function subscribeBciBridge(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBciBridge(): BciBridgeState {
  return state
}

export function setBciSelection(conversationId: string | null): void {
  if (state.selectedConversationId === conversationId) return
  state = { ...state, selectedConversationId: conversationId }
  emit()
}

export function getBciSelection(): string | null {
  return state.selectedConversationId
}

export function setPendingBciAction(envelope: ActionEnvelope): void {
  state = { ...state, pendingAction: envelope, selectedConversationId: envelope.conversationId }
  emit()
}

export function consumePendingBciAction(): ActionEnvelope | null {
  const pending = state.pendingAction
  if (pending) {
    state = { ...state, pendingAction: null }
    emit()
  }
  return pending
}

export function navigateToMessages(): void {
  window.dispatchEvent(new CustomEvent('bozz:navigate', { detail: '/messages' }))
}
