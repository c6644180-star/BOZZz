/** Client for the local BOZZ memory API. Only text the user asks to remember is stored. */

export interface MemoryFact {
  id: string
  text: string
  source: string
  created_at: string
  updated_at: string
}

export interface MemoryStatus {
  permissionGranted: boolean
  useInChat: boolean
  count: number | null
  maxItems: number
  maxChars: number
}

export class MemoryError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'MemoryError'
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new MemoryError('The BOZZ backend is not reachable, so memory is unavailable right now.', 0)
  }
  const body = (await response.json().catch(() => ({}))) as { detail?: unknown }
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `The memory request failed (${response.status}).`
    throw new MemoryError(detail, response.status)
  }
  return body as T
}

export async function fetchMemoryStatus(): Promise<MemoryStatus> {
  const body = await call<{
    permission_granted?: boolean
    use_in_chat?: boolean
    count?: number | null
    max_items?: number
    max_chars?: number
  }>('/memory/status')
  return {
    permissionGranted: body.permission_granted === true,
    useInChat: body.use_in_chat === true,
    count: typeof body.count === 'number' ? body.count : null,
    maxItems: body.max_items ?? 200,
    maxChars: body.max_chars ?? 500,
  }
}

export async function listMemory(query?: string): Promise<MemoryFact[]> {
  const suffix = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  return (await call<{ facts: MemoryFact[] }>(`/memory/facts${suffix}`)).facts
}

export const addMemory = (text: string, source: 'user' | 'voice' | 'import' = 'user') =>
  call<MemoryFact>('/memory/facts', { method: 'POST', body: JSON.stringify({ text, source }) })

export const updateMemory = (id: string, text: string) =>
  call<MemoryFact>(`/memory/facts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ text }) })

export const deleteMemory = (id: string) =>
  call<{ deleted: boolean }>(`/memory/facts/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const forgetMemory = async (phrase: string) =>
  (await call<{ deleted: number }>('/memory/forget', { method: 'POST', body: JSON.stringify({ phrase }) })).deleted

export const clearMemory = async () =>
  (await call<{ deleted: number }>('/memory/clear', { method: 'POST', body: JSON.stringify({ confirm: true }) })).deleted

export const exportMemory = () => call<Record<string, unknown>>('/memory/export')

export const setMemoryInChat = (useInChat: boolean) =>
  call<{ use_in_chat: boolean }>('/memory/settings', { method: 'POST', body: JSON.stringify({ use_in_chat: useInChat }) })