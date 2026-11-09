'use strict'

/**
 * Small state machine for full ↔ mini mode. Switching modes must never alter
 * microphone or camera activity: those sensors keep doing whatever the user
 * asked before the switch, and their indicator state is carried across.
 */

const MODES = new Set(['full', 'mini'])

function initialState() {
  return { mode: 'full', micListening: false, cameraActive: false }
}

function reduceMode(state, event) {
  const current = state && MODES.has(state.mode) ? state : initialState()
  if (!event || typeof event !== 'object') return current
  switch (event.type) {
    case 'enter-mini':
      return current.mode === 'mini' ? current : { ...current, mode: 'mini' }
    case 'exit-mini':
      return current.mode === 'full' ? current : { ...current, mode: 'full' }
    case 'mic':
      if (typeof event.value !== 'boolean' || current.micListening === event.value) return current
      return { ...current, micListening: event.value }
    case 'camera':
      if (typeof event.value !== 'boolean' || current.cameraActive === event.value) return current
      return { ...current, cameraActive: event.value }
    default:
      return current
  }
}

module.exports = { MODES, initialState, reduceMode }
