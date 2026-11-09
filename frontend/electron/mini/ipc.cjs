'use strict'

/**
 * Every message that crosses the contextBridge is treated as untrusted.
 * These functions return a fresh, bounded object or null, so the main process
 * never forwards an unexpected shape to another window.
 */

const MODES = new Set(['full', 'mini'])
const ORB_STATES = new Set(['idle', 'listening', 'thinking', 'speaking', 'error', 'offline'])
const ACTION_TYPES = new Set([
  'hover',
  'drag-start',
  'drag-move',
  'drag-end',
  'listen',
  'mute',
  'stop-speak',
  'expand',
  'quit',
  'menu',
  'emergency-stop',
  'approval',
  'ptt-start',
  'ptt-end',
])
const SIZES = new Set(['small', 'medium'])
const SPEEDS = new Set(['slow', 'normal'])
const DOCK_CORNERS = new Set(['free', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])
const MONITORS = new Set(['cursor', 'primary'])
const THEMES = new Set(['gold', 'cyan'])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidMode(value) {
  return typeof value === 'string' && MODES.has(value)
}

function text(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

function integer(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function number(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function sanitizeApproval(input) {
  if (!isRecord(input)) return null
  const id = typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : null
  if (!id) return null
  return {
    id,
    label: text(input.label, 200).trim() || 'Desktop action',
    tier: integer(input.tier, 0, 3, 2),
    source: text(input.source, 32) || 'unknown',
    target: typeof input.target === 'string' ? input.target.slice(0, 260) : null,
    expiresInMs: integer(input.expiresInMs, 0, 120000, 0),
  }
}

function sanitizeMiniState(input) {
  if (!isRecord(input)) return null
  return {
    orbState: typeof input.orbState === 'string' && ORB_STATES.has(input.orbState) ? input.orbState : 'idle',
    caption: text(input.caption, 600),
    listening: input.listening === true,
    micAvailable: input.micAvailable === true,
    cameraActive: input.cameraActive === true,
    desktopOn: input.desktopOn === true,
    emergency: input.emergency === true,
    approval: sanitizeApproval(input.approval),
  }
}

function sanitizeMiniAction(input) {
  if (!isRecord(input) || typeof input.type !== 'string' || !ACTION_TYPES.has(input.type)) return null
  switch (input.type) {
    case 'hover':
      return { type: 'hover', value: input.value === true }
    case 'drag-start':
      return {
        type: 'drag-start',
        screenX: integer(input.screenX, -100000, 100000, 0),
        screenY: integer(input.screenY, -100000, 100000, 0),
      }
    case 'drag-move':
      return {
        type: 'drag-move',
        screenX: integer(input.screenX, -100000, 100000, 0),
        screenY: integer(input.screenY, -100000, 100000, 0),
      }
    case 'drag-end':
      return { type: 'drag-end', moved: input.moved === true }
    case 'approval': {
      const id = typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : null
      if (!id) return null
      return { type: 'approval', id, approve: input.approve === true }
    }
    default:
      return { type: input.type }
  }
}

const DEFAULT_CONFIG = Object.freeze({
  size: 'small',
  opacity: 0.96,
  wander: true,
  wanderSpeed: 'normal',
  dock: 'free',
  monitor: 'cursor',
  theme: 'gold',
  reduceMotion: false,
  captions: true,
  pauseOnBattery: true,
  pushToTalk: true,
  pushToTalkKey: 'Space',
})

function sanitizeMiniConfig(input) {
  const source = isRecord(input) ? input : {}
  return {
    size: SIZES.has(source.size) ? source.size : DEFAULT_CONFIG.size,
    opacity: number(source.opacity, 0.35, 1, DEFAULT_CONFIG.opacity),
    wander: source.wander !== false,
    wanderSpeed: SPEEDS.has(source.wanderSpeed) ? source.wanderSpeed : DEFAULT_CONFIG.wanderSpeed,
    dock: DOCK_CORNERS.has(source.dock) ? source.dock : DEFAULT_CONFIG.dock,
    monitor: MONITORS.has(source.monitor) ? source.monitor : DEFAULT_CONFIG.monitor,
    theme: THEMES.has(source.theme) ? source.theme : DEFAULT_CONFIG.theme,
    reduceMotion: source.reduceMotion === true,
    captions: source.captions !== false,
    pauseOnBattery: source.pauseOnBattery !== false,
    pushToTalk: source.pushToTalk !== false,
    pushToTalkKey:
      source.pushToTalkKey === 'Control+Space' || source.pushToTalkKey === 'Alt+Space'
        ? source.pushToTalkKey
        : 'Space',
  }
}

module.exports = {
  ACTION_TYPES,
  DEFAULT_CONFIG,
  isValidMode,
  sanitizeApproval,
  sanitizeMiniState,
  sanitizeMiniAction,
  sanitizeMiniConfig,
}
