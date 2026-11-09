import type { IntentView } from './intent'

export type BciSource = 'manual' | 'text' | 'json' | 'whatsapp' | 'simulation'
export type BciAction = 'summarise' | 'unanswered' | 'attention' | 'draft' | 'rewrite' | 'translate'

export interface BciProviderInfo {
  provider: string
  model: string
  available: boolean
  local: boolean
  detail: string | null
  confirmed: boolean
  requires_confirmation: boolean
  permission_granted?: boolean
}

export interface BciConversationSummary {
  id: string
  title: string
  source: BciSource
  retention_days: number
  created_at: string
  updated_at: string
  messages_count: number
  char_count: number
  needs_attention: number
  unanswered_count: number
  last_message_at: string | null
  search_excerpt?: string
}

export interface BciMessage {
  id: string
  conversation_id: string
  sender: string
  text: string
  direction: 'inbound' | 'outbound'
  sent_at: string
  created_at: string
  attention: string[]
  unanswered: boolean
}

export interface BciDraft {
  id: string
  conversation_id: string
  text: string
  language: string
  tone: string
  placeholders: string[]
  created_at: string
  updated_at: string
  not_sent: true
}

export interface BciConversation extends BciConversationSummary {
  messages: BciMessage[]
  drafts: BciDraft[]
  provider: BciProviderInfo
}

export interface BciImportPreview {
  format: 'text' | 'json' | 'whatsapp'
  title: string
  source: BciSource
  message_count: number
  char_count: number
  inbound_count: number
  outbound_count: number
  first_at: string
  last_at: string
  messages: Array<{
    sender: string
    text: string
    direction: 'inbound' | 'outbound'
    sent_at: string
  }>
  truncated: boolean
  warnings: string[]
}

export interface BciSettings {
  retention_days: number
  options: number[]
}

export interface BciStyle {
  language: string
  formality: 'casual' | 'neutral' | 'formal'
  length: 'short' | 'medium' | 'long'
  tone: 'friendly' | 'neutral' | 'direct' | 'warm' | 'professional'
  expressions: string[]
  updated_at: string | null
}

export interface BciActionResult {
  kind: BciAction
  text: string
  placeholders: string[]
  draft: BciDraft | null
  items: Array<{
    message_id: string
    sender: string
    sent_at: string
    reasons: string[]
    excerpt: string
  }>
  questions: Array<{
    message_id: string
    sender: string
    sent_at: string
    text: string
  }>
  provider: string
  model: string
  messages_used: number
  message_count: number
}

export interface BciActionResponse extends IntentView {
  result: BciActionResult | null
}

export class BciApiError extends Error {
  readonly status: number
  readonly provider: string | null
  readonly confirmationRequired: boolean

  constructor(message: string, status: number, provider: string | null = null, confirmationRequired = false) {
    super(message)
    this.name = 'BciApiError'
    this.status = status
    this.provider = provider
    this.confirmationRequired = confirmationRequired
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(90_000),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string | { message?: string; provider?: string; confirmation_required?: boolean }
  }
  if (!response.ok) {
    const detail = body.detail
    if (typeof detail === 'string') throw new BciApiError(detail, response.status)
    throw new BciApiError(
      detail?.message || `The Messages request failed (${response.status}).`,
      response.status,
      detail?.provider ?? null,
      detail?.confirmation_required === true,
    )
  }
  return body as T
}

const json = (payload: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(payload),
})

export const fetchBciProvider = () => requestJson<BciProviderInfo>('/api/bci/provider')

export const confirmBciProvider = (provider: string) =>
  requestJson<BciProviderInfo>('/api/bci/provider/confirm', json({ provider, confirm: true }))

export const fetchBciSettings = () => requestJson<BciSettings>('/api/bci/settings')

export const saveBciSettings = (retentionDays: number) =>
  requestJson<BciSettings>('/api/bci/settings', {
    method: 'PUT',
    body: JSON.stringify({ retention_days: retentionDays }),
  })

export const fetchBciStyle = () => requestJson<BciStyle>('/api/bci/style')

export const saveBciStyle = (style: Omit<BciStyle, 'updated_at'>) =>
  requestJson<BciStyle>('/api/bci/style', { method: 'PUT', body: JSON.stringify(style) })

export const listConversations = (
  options: { q?: string; source?: string; attention?: boolean; signal?: AbortSignal } = {},
) => {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  if (options.source) params.set('source', options.source)
  if (options.attention) params.set('attention', 'true')
  const suffix = params.toString()
  return requestJson<{ conversations: BciConversationSummary[] }>(
    `/api/bci/conversations${suffix ? `?${suffix}` : ''}`,
    { signal: options.signal },
  )
}

export const getConversation = (id: string, signal?: AbortSignal) =>
  requestJson<{ conversation: BciConversation }>(
    `/api/bci/conversations/${encodeURIComponent(id)}`,
    { signal },
  )

export const createConversation = (payload: {
  title?: string | null
  source?: BciSource
  messages: Array<{ sender?: string; text: string; direction?: 'inbound' | 'outbound'; sent_at?: string }>
}) => requestJson<{ conversation: BciConversation }>('/api/bci/conversations', json(payload))

export const updateConversation = (
  id: string,
  payload: { title?: string | null; retention_days?: number | null },
) =>
  requestJson<{ conversation: BciConversation }>(
    `/api/bci/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  )

export const deleteConversation = (id: string) =>
  requestJson<{ deleted: boolean; id: string }>(
    `/api/bci/conversations/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )

export const deleteAllConversations = () =>
  requestJson<{ deleted: boolean; count: number }>(
    '/api/bci/conversations/delete-all',
    json({ confirm: true }),
  )

export const previewImport = (filename: string, content: string) =>
  requestJson<{ preview: BciImportPreview }>(
    '/api/bci/import/preview',
    json({ filename, content }),
  )

export const importConversation = (filename: string, content: string, title?: string) =>
  requestJson<{ conversation: BciConversation }>(
    '/api/bci/import',
    json({ filename, content, title: title || null }),
  )

export const createDraft = (
  conversationId: string,
  payload: { text: string; language?: string; tone?: string },
) =>
  requestJson<{ draft: BciDraft }>(
    `/api/bci/conversations/${encodeURIComponent(conversationId)}/drafts`,
    json(payload),
  )

export const updateDraft = (
  draftId: string,
  payload: { text?: string; language?: string; tone?: string },
) =>
  requestJson<{ draft: BciDraft }>(
    `/api/bci/drafts/${encodeURIComponent(draftId)}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  )

export const deleteDraft = (draftId: string) =>
  requestJson<{ deleted: boolean; id: string }>(
    `/api/bci/drafts/${encodeURIComponent(draftId)}`,
    { method: 'DELETE' },
  )

export const runBciAction = (
  conversationId: string,
  action: BciAction,
  payload: { text?: string; draft_id?: string; language?: string; tone?: string; instruction?: string } = {},
) =>
  requestJson<BciActionResponse>(
    `/api/bci/conversations/${encodeURIComponent(conversationId)}/actions`,
    json({ action, ...payload }),
  )

export function placeholderPattern(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/\[CONFIRM:\s*([^\]]{1,300})\]/gi)) {
    const question = match[1].trim()
    if (question && !found.includes(question)) found.push(question)
  }
  return found
}

export function stripPlaceholders(text: string): string {
  return text
    .replace(/\[CONFIRM:\s*[^\]]{1,300}\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sourceLabel(source: BciSource): string {
  return {
    manual: 'Manual',
    text: 'Text import',
    json: 'JSON import',
    whatsapp: 'WhatsApp export',
    simulation: 'Simulation',
  }[source]
}

export const SAMPLE_CONVERSATION = {
  title: 'Simulation · Product sync',
  source: 'simulation' as const,
  messages: [
    {
      sender: 'Priya',
      direction: 'inbound' as const,
      text: 'Hi, can you share the updated quote for the dashboard work?',
    },
    {
      sender: 'Me',
      direction: 'outbound' as const,
      text: 'I will check the numbers and get back to you.',
    },
    {
      sender: 'Priya',
      direction: 'inbound' as const,
      text: 'Thanks. Also, what is the final deadline for the first milestone?',
    },
    {
      sender: 'Me',
      direction: 'outbound' as const,
      text: 'Let me confirm with the team.',
    },
  ],
}
