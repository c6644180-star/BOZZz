import type { MiniDock, MiniMonitor, MiniOrbSize, MiniWanderSpeed } from './bozz'

export type MiniMode = 'full' | 'mini'

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

export interface MiniPause {
  paused: boolean
  reasons: string[]
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

export type DesktopAppId = 'calculator' | 'notepad' | 'paint'

export interface DesktopLaunchResult { ok: boolean; appId?: DesktopAppId; reason?: string }

export interface ManagedDesktopWindow { id: 'main' | 'mini'; title: string; visible: boolean; focused: boolean; minimized: boolean }
export interface ManagedWindowFocusResult { ok: boolean; id?: 'main' | 'mini'; reason?: string }
export type ExternalDesktopAppId = 'notepad' | 'paint' | 'calculator' | 'edge' | 'chrome' | 'vscode'
export interface ExternalDesktopWindow { id: string; appId: ExternalDesktopAppId; appName: string }
export interface ExternalWindowListResult { ok: boolean; windows: ExternalDesktopWindow[]; reason?: string }
export interface ExternalWindowFocusResult { ok: boolean; appId?: ExternalDesktopAppId; appName?: string; reason?: string }

export interface DesktopBridge {
  isDesktop: true
  setMode: (mode: MiniMode) => void
  getMode: () => Promise<MiniMode>
  launchApp: (appId: DesktopAppId) => Promise<DesktopLaunchResult>
  listManagedWindows: () => Promise<ManagedDesktopWindow[]>
  focusManagedWindow: (id: 'main' | 'mini') => Promise<ManagedWindowFocusResult>
  listExternalWindows: () => Promise<ExternalWindowListResult>
  focusExternalWindow: (id: string) => Promise<ExternalWindowFocusResult>
  openFull: () => void
  quit: () => void
  publishMiniState: (state: MiniState) => void
  publishMiniConfig: (config: MiniConfig) => void
  sendMiniAction: (action: MiniAction) => void
  onMiniState: (listener: (state: MiniState) => void) => () => void
  onMiniConfig: (listener: (config: MiniConfig) => void) => () => void
  onMiniPause: (listener: (pause: MiniPause) => void) => () => void
  onMiniMode: (listener: (mode: { mode: MiniMode }) => void) => () => void
  onMiniAction: (listener: (action: MiniAction) => void) => () => void
}

declare global {
  interface Window {
    bozzDesktop?: DesktopBridge
  }
}

export {}
