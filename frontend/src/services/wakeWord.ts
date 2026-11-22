export interface WakeWordAssetStatus {
  configured: boolean
  files: Record<string, {
    configured: boolean
    exists: boolean
    file_name: string | null
    supported_format: boolean
  }>
  runtime_available: boolean
  engine_loadable: boolean
  microphone_opened: boolean
  registry_configured?: boolean
  active_version?: string | null
  registry_status?: string
  status: string
  detail: string
}

async function requestStatus(validate: boolean, signal?: AbortSignal): Promise<WakeWordAssetStatus> {
  const response = await fetch(validate ? '/api/voice/wake-word/validate' : '/api/voice/wake-word/status', {
    method: validate ? 'POST' : 'GET',
    signal: signal ?? AbortSignal.timeout(validate ? 30000 : 5000),
    headers: validate ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = await response.json().catch(() => ({})) as Partial<WakeWordAssetStatus> & { detail?: string }
  if (!response.ok) throw new Error(body.detail ?? `Wake-word diagnostics failed (HTTP ${response.status}).`)
  return {
    configured: body.configured === true,
    files: body.files ?? {},
    runtime_available: body.runtime_available === true,
    engine_loadable: body.engine_loadable === true,
    microphone_opened: body.microphone_opened === true,
    status: body.status ?? 'unknown',
    detail: body.detail ?? 'The backend returned no diagnostic details.',
  }
}

export function fetchWakeWordStatus(signal?: AbortSignal): Promise<WakeWordAssetStatus> {
  return requestStatus(false, signal)
}

export function validateWakeWordAssets(signal?: AbortSignal): Promise<WakeWordAssetStatus> {
  return requestStatus(true, signal)
}
