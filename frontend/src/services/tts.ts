import type { TTSServerStatus } from '../types/bozz'

// The API key lives only on the backend. The browser only ever receives
// status flags and audio bytes.

export async function fetchTTSStatus(signal?: AbortSignal): Promise<TTSServerStatus> {
  try {
    const response = await fetch('/api/tts/status', {
      signal: signal ?? AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error('status')
    const body = (await response.json()) as {
      configured?: boolean
      voice_configured?: boolean
      model?: string
    }
    const model = typeof body.model === 'string' && body.model ? body.model : 'ElevenLabs'
    if (body.configured !== true || body.voice_configured === false) {
      return {
        configured: false,
        model,
        detail: body.voice_configured === false
          ? 'ElevenLabs voice ID is missing on the backend.'
          : 'ElevenLabs is not configured on the backend.',
      }
    }
    return { configured: true, model, detail: null }
  } catch {
    return {
      configured: false,
      model: 'ElevenLabs',
      detail: 'Speech service status is unavailable. The backend may be offline.',
    }
  }
}

export async function requestSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(65000)])
    : AbortSignal.timeout(60000)
  const response = await fetch('/api/tts', {
    method: 'POST',
    signal: requestSignal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: unknown }
    const detail = typeof body.detail === 'string'
      ? body.detail
      : `The speech service returned HTTP ${response.status}.`
    throw new Error(detail)
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('The speech service returned no audio.')
  return blob
}
