export type VoiceMode = 'push-to-talk' | 'wake-word' | 'manual'

export const VOICE_MODE_COPY: Record<VoiceMode, { label: string; detail: string }> = {
  'push-to-talk': {
    label: 'Push-to-talk',
    detail: 'Hold the key to listen, release to send. The microphone is closed at all other times.',
  },
  'wake-word': {
    label: 'Wake word (not installed)',
    detail: 'Requires a trained local BOZZ wake-word model. No background microphone listener is started until that engine is installed and explicitly enabled.',
  },
  manual: {
    label: 'Manual',
    detail: 'The microphone stays closed until you press the mic button. It closes again after each command.',
  },
}

export function resolveVoiceMode(settings: { voiceMode?: unknown; wakeWord?: boolean }): VoiceMode {
  if (settings.voiceMode === 'wake-word' || settings.voiceMode === 'manual' || settings.voiceMode === 'push-to-talk') {
    return settings.voiceMode
  }
  return settings.wakeWord === true ? 'wake-word' : 'push-to-talk'
}

export function canOpenMicrophone(mode: VoiceMode, hasManualPress: boolean, backgroundGatePassed = false): boolean {
  // Wake-word mode is never permission by itself. It requires the separately
  // verified background gate; all other modes require a current manual press.
  return hasManualPress || (mode === 'wake-word' && backgroundGatePassed)
}

export function pttLatencyMs(releasedAt: number, finalisedAt: number): number | null {
  if (!Number.isFinite(releasedAt) || !Number.isFinite(finalisedAt)) return null
  const value = finalisedAt - releasedAt
  return value >= 0 ? value : null
}

export function voiceModeNeedsBackgroundListening(mode: VoiceMode): boolean {
  return mode === 'wake-word'
}

export function shouldSuspendOnLoad(mode: VoiceMode, sustainedHigh: boolean): boolean {
  return mode === 'wake-word' && sustainedHigh
}

export const HIGH_LOAD_MESSAGE =
  'Main-thread load stayed high, so wake-word listening was suspended. BOZZ switched to push-to-talk. Two speech models never run at once.'


/**
 * A background listener may start only when all four independent conditions
 * are true. Consent is a user preference, not a substitute for OS permission
 * or an installed local wake-word engine.
 */
export function canStartBackgroundListening(input: {
  mode: VoiceMode
  consentGranted: boolean
  engineAvailable: boolean
  osPermissionGranted: boolean
}): boolean {
  return input.mode === 'wake-word' &&
    input.consentGranted &&
    input.engineAvailable &&
    input.osPermissionGranted
}
