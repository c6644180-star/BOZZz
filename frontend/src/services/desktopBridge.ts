import type { DesktopBridge } from '../types/desktop'

/**
 * Mini mode exists only inside the Electron shell. In a normal browser this
 * returns null and every mini control is hidden or disabled with a note.
 */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const api = window.bozzDesktop
  return api && api.isDesktop === true ? api : null
}

export function isDesktopApp(): boolean {
  return desktopBridge() !== null
}
