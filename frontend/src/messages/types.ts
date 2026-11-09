import type { BciAction, BciActionResponse } from '../services/bci'

export interface BciActionPayload {
  text?: string
  draft_id?: string
  language?: string
  tone?: string
  instruction?: string
}

export interface ActionEnvelope {
  id: string
  conversationId: string
  action: BciAction
  response: BciActionResponse
  payload?: BciActionPayload
}
