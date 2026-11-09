import type { AIProviderStatus, ChatMessage, ConnStatus } from '../types/bozz'

const HEALTH_URL = '/api/health'

export async function probeBackend(signal?: AbortSignal): Promise<ConnStatus> {
  try {
    const response = await fetch(HEALTH_URL, { signal: signal ?? AbortSignal.timeout(2500) })
    if (!response.ok) return 'offline'
    const body = (await response.json()) as { status?: string }
    return body.status === 'healthy' ? 'online' : 'offline'
  } catch {
    return 'offline'
  }
}

export async function fetchAIStatus(signal?: AbortSignal): Promise<AIProviderStatus> {
  try {
    const response = await fetch('/api/ai/status', { signal: signal ?? AbortSignal.timeout(3500) })
    if (!response.ok) throw new Error('The BOZZ backend did not return an AI status.')
    const body = await response.json() as {
      available?: boolean
      provider?: string
      configured_model?: string
      models?: string[]
      detail?: string | null
    }
    return {
      available: body.available === true,
      provider: body.provider ?? 'ollama',
      configuredModel: body.configured_model ?? 'not configured',
      models: Array.isArray(body.models) ? body.models : [],
      detail: body.detail ?? null,
    }
  } catch {
    return {
      available: false,
      provider: 'ollama',
      configuredModel: 'not reachable',
      models: [],
      detail: 'BOZZ backend or Ollama is not reachable on this device.',
    }
  }
}

export async function requestChat(message: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const history = messages.slice(-12).map((item) => ({
    role: item.from === 'bozz' ? 'assistant' : 'user',
    content: item.text,
  }))
  const response = await fetch('/api/chat', {
    method: 'POST',
    signal: signal ?? AbortSignal.timeout(70000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })
  const body = await response.json().catch(() => ({})) as { reply?: string; detail?: string }
  if (!response.ok || !body.reply) throw new Error(body.detail || 'The local model did not return a response.')
  return body.reply
}
