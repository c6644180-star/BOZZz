import { Square } from 'lucide-react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import type { OrbState } from '../../types/bozz'

const LABEL: Record<OrbState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Error',
  offline: 'Offline',
}

export function OrbVoiceStatus({ state }: { state: OrbState }) {
  const { orbState, stopVoice } = useBozzVoice()

  return (
    <div className="orb-voice-status">
      <span
        className={`orb-voice-status__state orb-voice-status__state--${state}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <i aria-hidden="true" />
        {LABEL[state]}
      </span>
      {orbState === 'speaking' && (
        <button
          type="button"
          className="orb-voice-status__stop"
          onClick={stopVoice}
          aria-label="Stop voice playback"
          title="Stop voice playback (Esc)"
        >
          <Square />
          Stop
        </button>
      )}
    </div>
  )
}
