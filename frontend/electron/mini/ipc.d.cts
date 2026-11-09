export type MiniOrbSize = 'small' | 'medium'
export type MiniWanderSpeed = 'slow' | 'normal'
export type MiniDock = 'free' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type MiniMonitor = 'cursor' | 'primary'
export type MiniPushToTalkKey = 'Space' | 'Control+Space' | 'Alt+Space'

export interface MiniConfig {
  size: MiniOrbSize
  opacity: number
  wander: boolean
  wanderSpeed: MiniWanderSpeed
  dock: MiniDock
  monitor: MiniMonitor
  theme: 'gold' | 'cyan'
  reduceMotion: boolean
  captions: boolean
  pauseOnBattery: boolean
  pushToTalk: boolean
  pushToTalkKey: MiniPushToTalkKey
}

export interface MiniApproval {
  id: string
  label: string
  tier: number
  source: string
  target: string | null
  expiresInMs: number
}

export interface MiniState {
  orbState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'offline'
  caption: string
  listening: boolean
  micAvailable: boolean
  cameraActive: boolean
  desktopOn: boolean
  emergency: boolean
  approval: MiniApproval | null
}

export type MiniAction =
  | { type: 'hover'; value: boolean }
  | { type: 'drag-start'; screenX: number; screenY: number }
  | { type: 'drag-move'; screenX: number; screenY: number }
  | { type: 'drag-end'; moved: boolean }
  | { type: 'listen' }
  | { type: 'mute' }
  | { type: 'stop-speak' }
  | { type: 'expand' }
  | { type: 'quit' }
  | { type: 'menu' }
  | { type: 'emergency-stop' }
  | { type: 'approval'; id: string; approve: boolean }
  | { type: 'ptt-start' }
  | { type: 'ptt-end' }

export interface MiniPause {
  paused: boolean
  reasons: string[]
}

export declare const ACTION_TYPES: Set<string>
export declare const DEFAULT_CONFIG: Readonly<MiniConfig>
export declare function isValidMode(value: unknown): value is 'full' | 'mini'
export declare function sanitizeApproval(input: unknown): MiniApproval | null
export declare function sanitizeMiniState(input: unknown): MiniState | null
export declare function sanitizeMiniAction(input: unknown): MiniAction | null
export declare function sanitizeMiniConfig(input: unknown): MiniConfig
