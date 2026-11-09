import { Eraser } from 'lucide-react'
import { CommandBar } from '../components/chat/CommandBar'
import { Transcript } from '../components/chat/Transcript'
import { Orb } from '../components/orb/Orb'
import { OrbVoiceStatus } from '../components/orb/OrbVoiceStatus'
import { VoiceWave } from '../components/orb/VoiceWave'
import { useBozzVoice } from '../hooks/useBozzVoice'
import type { ConnStatus } from '../types/bozz'

export default function ChatPage({ status }: { status: ConnStatus }) {
  const { orbState, caption, settings, tts, ttsServer, voiceNote, mic, ai, resetConversation } = useBozzVoice()
  const visualOrbState = status === 'offline' && orbState === 'idle' ? 'offline' : orbState

  return (
    <section className="chat-page">
      <div className="chat-stage">
        <div className="orb-stack">
          <Orb state={visualOrbState} />
          <OrbVoiceStatus state={visualOrbState} />
          <VoiceWave active={orbState === 'speaking'} />
          <p className="voice-note" role="status">{voiceNote}</p>
        </div>
      </div>
      <div className="chat-bottom">
        {settings.captions && (
          <p className="chat-caption" aria-live="polite">
            {caption}
          </p>
        )}
        <Transcript />
        <CommandBar placeholder="Message BOZZ…" />
      </div>
      <div className="voice-status-row">
        <span>Local AI: {ai.available ? `${ai.provider} · ${ai.configuredModel}` : `unavailable — ${ai.detail ?? 'checking'}`}</span>
        <span>Conversation: saved in this browser</span>
        <span>
          Speech output: {ttsServer.configured
            ? `ElevenLabs · ${ttsServer.model}`
            : `browser fallback${tts.available ? '' : ' (unsupported)'} — ${ttsServer.detail ?? 'ElevenLabs not configured'}`}
        </span>
        <span>Voice input: {mic.available ? (mic.listening ? 'listening…' : 'available (browser engine)') : `unavailable${mic.reason ? ` — ${mic.reason}` : ''}`}</span>
        <button type="button" onClick={resetConversation}><Eraser /> Clear</button>
      </div>
    </section>
  )
}
