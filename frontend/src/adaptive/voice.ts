export type VoiceMode = 'push-to-talk' | 'wake-word' | 'manual'

export const VOICE_MODE_COPY: Record<VoiceMode, { label: string; detail: string }> = {
  'push-to-talk': {
    label: 'Push-to-talk',
    detail: 'Hold the key to listen, release to send. The microphone is closed at all other times.',
  },
  'wake-word': {
    label: 'Wake word (experimental)',
    detail: 'After the mic is opened, BOZZ keeps listening until it hears “BOZZ …”. Uses browser speech; no offline wake-word engine is installed.',
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

export function canOpenMicrophone(mode: VoiceMode, hasManualPress: boolean): boolean {
  if (mode === 'manual') return hasManualPress
  return true
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
