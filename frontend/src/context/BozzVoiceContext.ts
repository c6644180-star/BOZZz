import { createContext } from 'react'
import type { AIProviderStatus, ChatMessage, OrbState, TTSServerStatus, VoiceSettings } from '../types/bozz'
import type { ActionClass } from '../adaptive/types'

export interface VoiceClarification {
  command: string
  prompt: string
  confidence: number
  actionClass: ActionClass
}

export interface VoiceStatus {
  available: boolean
  supported: boolean
}

export interface MicStatus {
  available: boolean
  listening: boolean
  reason: string | null
}

export interface BozzVoice {
  orbState: OrbState
  caption: string
  messages: ChatMessage[]
  settings: VoiceSettings
  tts: VoiceStatus
  ttsServer: TTSServerStatus
  voiceNote: string | null
  mic: MicStatus
  ai: AIProviderStatus
  clarification: VoiceClarification | null
  setCaption: (text: string) => void
  submit: (text: string) => void
  resolveClarification: (accept: boolean) => void
  stopVoice: () => void
  toggleListening: () => void
  pauseInteraction: (caption?: string) => void
  pushToTalkStart: () => void
  pushToTalkEnd: () => void
  updateSettings: (patch: Partial<VoiceSettings>) => void
  resetConversation: () => void
}

export const BozzVoiceContext = createContext<BozzVoice | null>(null)
