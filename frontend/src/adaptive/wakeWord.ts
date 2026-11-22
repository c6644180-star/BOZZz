export interface WakeWordStartResult {
  ok: boolean
  detail: string
}

export interface WakeWordEngine {
  id: string
  label: string
  offline: boolean
  available: boolean
  reason: string | null
  start: (onWake: () => void) => Promise<WakeWordStartResult>
  stop: () => void
}

export const WAKE_WORD_NOT_INSTALLED =
  'No trained BOZZ classifier is bundled. Configure and validate a local model before manually starting the detector; the microphone stays off by default.'

export const WAKE_WORD_OPTIONS = [
  'Use push-to-talk (works today, no extra download).',
  'Use the manual mic button, then say “BOZZ …” (browser speech service, not offline).',
  'Configure a trained local BOZZ classifier and its feature models, validate them in Settings, then manually start the consent-gated detector.',
]

// Interface only. BOZZ ships no wake-word model, so this returns an honest
// not-installed engine instead of streaming audio to a cloud service.
const notInstalled: WakeWordEngine = {
  id: 'none',
  label: 'No offline wake-word engine',
  offline: true,
  available: false,
  reason: WAKE_WORD_NOT_INSTALLED,
  start: async () => ({ ok: false, detail: WAKE_WORD_NOT_INSTALLED }),
  stop: () => {},
}

export function getWakeWordEngine(): WakeWordEngine {
  return notInstalled
}

export function wakeWordStatus(): {
  installed: boolean
  detail: string
  options: string[]
} {
  const engine = getWakeWordEngine()
  return {
    installed: engine.available,
    detail: engine.available ? `${engine.label} is installed and runs offline.` : engine.reason ?? WAKE_WORD_NOT_INSTALLED,
    options: engine.available ? [] : [...WAKE_WORD_OPTIONS],
  }
}


export interface WakeWordStartGate {
  mode: 'push-to-talk' | 'wake-word' | 'manual'
  consentGranted: boolean
  osPermissionGranted: boolean
}

/** Centralized guard used by every future local engine adapter. */
export async function startWakeWordEngineSafely(
  engine: WakeWordEngine,
  gate: WakeWordStartGate,
  onWake: () => void,
): Promise<WakeWordStartResult> {
  if (!engine.available) {
    return { ok: false, detail: engine.reason ?? WAKE_WORD_NOT_INSTALLED }
  }
  if (gate.mode !== 'wake-word' || !gate.consentGranted || !gate.osPermissionGranted) {
    return { ok: false, detail: 'Background listening is blocked until wake-word mode, explicit consent, and OS microphone permission are all enabled.' }
  }
  return engine.start(onWake)
}
