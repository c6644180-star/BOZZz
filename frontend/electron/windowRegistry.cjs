'use strict'

const WINDOW_IDS = Object.freeze(['main', 'mini'])

function snapshotManagedWindows({ mainWindow, miniWindow }) {
  const entries = [
    ['main', mainWindow, 'BOZZ'],
    ['mini', miniWindow, 'BOZZ Mini Orb'],
  ]
  return entries.flatMap(([id, win, fallbackTitle]) => {
    if (!win || win.isDestroyed?.()) return []
    return [{
      id,
      title: String(win.getTitle?.() || fallbackTitle).slice(0, 120),
      visible: Boolean(win.isVisible?.()),
      focused: Boolean(win.isFocused?.()),
      minimized: Boolean(win.isMinimized?.()),
    }]
  })
}

function focusManagedWindow(id, { mainWindow, miniWindow }) {
  if (!WINDOW_IDS.includes(id)) return { ok: false, reason: 'Unknown BOZZ window.' }
  const win = id === 'main' ? mainWindow : miniWindow
  if (!win || win.isDestroyed?.()) return { ok: false, reason: 'That BOZZ window is not available.' }
  try {
    if (win.isMinimized?.()) win.restore()
    win.show()
    win.focus()
    return { ok: true, id }
  } catch {
    return { ok: false, reason: 'Windows could not focus that BOZZ window.' }
  }
}

module.exports = { WINDOW_IDS, snapshotManagedWindows, focusManagedWindow }
