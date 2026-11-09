import type { LucideIcon } from 'lucide-react'
import type { FrontendIntentTask } from './modules'

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'offline'

export type ConnStatus = 'checking' | 'online' | 'offline'

export interface AIProviderStatus {
  available: boolean
  provider: string
  configuredModel: string
  models: string[]
  detail: string | null
}

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  section: 'Operate' | 'Intelligence' | 'System'
  available?: boolean
}

export interface ProjectTask {
  id: string
  title: string
  done: boolean
  createdAt: number
}

export interface MemoryNote {
  id: string
  text: string
  createdAt: number
}

export interface BozzNotification {
  id: string
  text: string
  createdAt: number
  read: boolean
}

export interface ChatMessage {
  id: string
  from: 'user' | 'bozz'
  text: string
  createdAt: number
  local: boolean
}

export type ThemeName = 'cyan' | 'gold'

export type OrbQuality = 'low' | 'medium' | 'high'

export type OrbSize = 'medium' | 'large' | 'xl'

export type MiniOrbSize = 'small' | 'medium'
export type MiniWanderSpeed = 'slow' | 'normal'
export type MiniDock = 'free' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type MiniMonitor = 'cursor' | 'primary'

export interface MiniOrbSettings {
  wander: boolean
  wanderSpeed: MiniWanderSpeed
  dock: MiniDock
  opacity: number
  size: MiniOrbSize
  monitor: MiniMonitor
  pauseOnBattery: boolean
}

export type VoiceMode = 'push-to-talk' | 'wake-word' | 'manual'

export interface VoiceSettings {
  voiceOutput: boolean
  captions: boolean
  orbTheme: ThemeName
  orbQuality: OrbQuality
  orbSize: OrbSize
  orbOnly: boolean
  compactChat: boolean
  alwaysShowChat: boolean
  showWidgets: boolean
  reduceMotion: boolean
  backgroundEffects: boolean
  pushToTalk: boolean
  pushToTalkKey: 'Space' | 'Control+Space' | 'Alt+Space'
  wakeWord: boolean
  voiceMode: VoiceMode
  confirmLowConfidence: boolean
  logCommandText: boolean
  miniOrb: MiniOrbSettings
}

export interface TTSServerStatus {
  configured: boolean
  model: string
  detail: string | null
}

export type HistoryStatus = 'done' | 'running' | 'cancelled' | 'failed'

export interface HistoryEntry {
  id: string
  title: string
  kind: 'chat' | 'task'
  status: HistoryStatus
  createdAt: number
  updatedAt: number
  href: string
  intentTask?: FrontendIntentTask
}
