/**
 * Tracks whether the hidden main window is hidden because of mini mode.
 * Gesture/AI safety timers must not treat that deliberate hide as the user
 * abandoning the tab, and the camera pipeline keeps processing real frames.
 */
let miniModeActive = false

export const MINI_MODE_EVENT = 'bozz:mini-mode'

export function setMiniModeActive(value: boolean): void {
  if (miniModeActive === value) return
  miniModeActive = value
  window.dispatchEvent(new CustomEvent(MINI_MODE_EVENT, { detail: value }))
}

export function isMiniModeActive(): boolean {
  return miniModeActive
}
