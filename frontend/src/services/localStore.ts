import type {
  BozzNotification,
  ChatMessage,
  HistoryEntry,
  MemoryNote,
  MiniOrbSettings,
  ProjectTask,
  VoiceSettings,
} from '../types/bozz'
import type { PermissionMirror } from '../types/modules'

const KEYS = {
  projects: 'bozz.projects',
  memory: 'bozz.memory',
  notifications: 'bozz.notifications',
  settings: 'bozz.settings',
  conversation: 'bozz.conversation',
  history: 'bozz.history',
  modulePermissions: 'bozz.modulePermissions',
} as const

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked; local persistence is best-effort
  }
  window.dispatchEvent(new CustomEvent('bozz:local-store', { detail: key }))
}

export function onLocalStoreChange(handler: () => void): () => void {
  const listener = () => handler()
  window.addEventListener('bozz:local-store', listener)
  return () => window.removeEventListener('bozz:local-store', listener)
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const loadProjects = () => read<ProjectTask[]>(KEYS.projects, [])
export const saveProjects = (tasks: ProjectTask[]) => write(KEYS.projects, tasks)

export const loadNotes = () => read<MemoryNote[]>(KEYS.memory, [])
export const saveNotes = (notes: MemoryNote[]) => write(KEYS.memory, notes)

export const loadNotifications = () => read<BozzNotification[]>(KEYS.notifications, [])
export const saveNotifications = (items: BozzNotification[]) => write(KEYS.notifications, items)

// Conversation context is deliberately local and bounded. It is only sent to
// the selected local model when the user submits a follow-up message.
export const loadConversation = () => read<ChatMessage[]>(KEYS.conversation, [])
export const saveConversation = (messages: ChatMessage[]) => write(KEYS.conversation, messages.slice(-80))

// History records only real outcomes. Entries are created when a chat request
// starts and updated when it finishes, fails, or is cancelled.
export const loadHistory = () => read<HistoryEntry[]>(KEYS.history, [])

export const saveHistory = (entries: HistoryEntry[]) => write(KEYS.history, entries.slice(0, 60))

export function addHistoryEntry(entry: HistoryEntry): void {
  saveHistory([entry, ...loadHistory()])
}

export function patchHistoryEntry(id: string, patch: Partial<HistoryEntry>): void {
  saveHistory(loadHistory().map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
}

export const defaultSettings: VoiceSettings = {
  voiceOutput: true,
  captions: true,
  orbTheme: 'gold',
  orbQuality: 'medium',
  orbSize: 'large',
  orbOnly: true,
  compactChat: false,
  alwaysShowChat: false,
  showWidgets: false,
  reduceMotion: false,
  backgroundEffects: true,
  pushToTalk: true,
  pushToTalkKey: 'Space',
  wakeWord: false,
  voiceMode: 'push-to-talk',
  confirmLowConfidence: true,
  logCommandText: false,
  miniOrb: {
    wander: true,
    wanderSpeed: 'normal',
    dock: 'free',
    opacity: 0.96,
    size: 'small',
    monitor: 'cursor',
    pauseOnBattery: true,
  },
}

const MINI_DOCKS: MiniOrbSettings['dock'][] = ['free', 'top-left', 'top-right', 'bottom-left', 'bottom-right']

function normalizeMiniOrb(value: Partial<MiniOrbSettings> | undefined): MiniOrbSettings {
  const fallback = defaultSettings.miniOrb
  const opacity = typeof value?.opacity === 'number' && Number.isFinite(value.opacity) ? value.opacity : fallback.opacity
  return {
    wander: value?.wander !== false,
    wanderSpeed: value?.wanderSpeed === 'slow' ? 'slow' : 'normal',
    dock: value?.dock && MINI_DOCKS.includes(value.dock) ? value.dock : fallback.dock,
    opacity: Math.min(1, Math.max(0.35, Math.round(opacity * 100) / 100)),
    size: value?.size === 'medium' ? 'medium' : 'small',
    monitor: value?.monitor === 'primary' ? 'primary' : 'cursor',
    pauseOnBattery: value?.pauseOnBattery !== false,
  }
}

export function loadSettings(): VoiceSettings {
  const stored = read<Partial<VoiceSettings>>(KEYS.settings, {})
  const key = stored.pushToTalkKey
  // Settings written before the gold identity existed always carried the old
  // cyan default, so treat them as a one-time migration instead of a choice.
  const legacy = stored.orbTheme !== undefined && stored.backgroundEffects === undefined
  return {
    ...defaultSettings,
    ...stored,
    orbTheme: legacy ? 'gold' : stored.orbTheme === 'cyan' ? 'cyan' : 'gold',
    reduceMotion: stored.reduceMotion === true,
    backgroundEffects: stored.backgroundEffects !== false,
    pushToTalkKey:
      key === 'Space' || key === 'Control+Space' || key === 'Alt+Space'
        ? key
        : defaultSettings.pushToTalkKey,
    pushToTalk: stored.pushToTalk !== false,
    wakeWord: stored.wakeWord === true,
    orbSize:
      stored.orbSize === 'medium' || stored.orbSize === 'xl' || stored.orbSize === 'large'
        ? stored.orbSize
        : defaultSettings.orbSize,
    orbOnly: stored.orbOnly !== false,
    compactChat: stored.compactChat === true,
    alwaysShowChat: stored.alwaysShowChat === true,
    voiceMode:
      stored.voiceMode === 'wake-word' || stored.voiceMode === 'manual' || stored.voiceMode === 'push-to-talk'
        ? stored.voiceMode
        : stored.wakeWord === true
          ? 'wake-word'
          : 'push-to-talk',
    confirmLowConfidence: stored.confirmLowConfidence !== false,
    logCommandText: stored.logCommandText === true,
    miniOrb: normalizeMiniOrb(stored.miniOrb),
  }
}

export const saveSettings = (settings: VoiceSettings) => write(KEYS.settings, settings)

// The backend is authoritative for grants. This mirror lets the UI show the
// last confirmed state while offline; it is never used to bypass a server check.
export const loadPermissionMirror = () => read<PermissionMirror>(KEYS.modulePermissions, {})

export const savePermissionMirror = (mirror: PermissionMirror) =>
  write(KEYS.modulePermissions, mirror)

export function pushNotification(text: string): void {
  const items = loadNotifications()
  const next: BozzNotification = { id: uid(), text, createdAt: Date.now(), read: false }
  write(KEYS.notifications, [next, ...items].slice(0, 60))
}
