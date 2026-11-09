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
  'Wake word engine not installed. BOZZ has no built-in offline wake-word model, so nothing is listening in the background.'

export const WAKE_WORD_OPTIONS = [
  'Use push-to-talk (works today, no extra download).',
  'Use the manual mic button, then say “BOZZ …” (browser speech service, not offline).',
  'Install a local wake-word model such as openWakeWord or Porcupine with your own licence, then add an adapter that implements this interface.',
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
