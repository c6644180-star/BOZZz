'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * The renderer never sees Node or a general ipcRenderer. This preload exposes a
 * deliberately small, typed surface. The main process validates every message
 * again; these checks only reject obvious mistakes early.
 */

const last = { state: null, config: null, pause: null, mode: null }

function remember(channel, payload) {
  if (channel === 'mini:state') last.state = payload
  if (channel === 'mini:config') last.config = payload
  if (channel === 'mini:pause') last.pause = payload
  if (channel === 'mini:mode') last.mode = payload
  // The main window also listens on mini:action; only mini state-like channels
  // are cached, so nothing is replayed into the wrong window.
}

;['mini:state', 'mini:config', 'mini:pause', 'mini:mode'].forEach((channel) => {
  ipcRenderer.on(channel, (_event, payload) => remember(channel, payload))
})

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {}
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  if (channel === 'mini:state' && last.state) queueMicrotask(() => callback(last.state))
  if (channel === 'mini:config' && last.config) queueMicrotask(() => callback(last.config))
  if (channel === 'mini:pause' && last.pause) queueMicrotask(() => callback(last.pause))
  if (channel === 'mini:mode' && last.mode) queueMicrotask(() => callback(last.mode))
  return () => ipcRenderer.removeListener(channel, listener)
}

function sendMode(mode) {
  if (mode !== 'full' && mode !== 'mini') return
  ipcRenderer.send('mini:set-mode', mode)
}

function sendAction(action) {
  if (!action || typeof action !== 'object') return
  ipcRenderer.send('mini:action', action)
}

const api = {
  isDesktop: true,
  setMode: sendMode,
  getMode: async () => {
    const mode = await ipcRenderer.invoke('mini:get-mode')
    return mode === 'mini' ? 'mini' : 'full'
  },
  openFull: () => ipcRenderer.send('mini:open-full'),
  quit: () => ipcRenderer.send('mini:quit'),
  publishMiniState: (state) => {
    if (state && typeof state === 'object') ipcRenderer.send('mini:state', state)
  },
  publishMiniConfig: (config) => {
    if (config && typeof config === 'object') ipcRenderer.send('mini:config', config)
  },
  sendMiniAction: sendAction,
  onMiniState: (callback) => subscribe('mini:state', callback),
  onMiniConfig: (callback) => subscribe('mini:config', callback),
  onMiniPause: (callback) => subscribe('mini:pause', callback),
  onMiniMode: (callback) => subscribe('mini:mode', callback),
  onMiniAction: (callback) => subscribe('mini:action', callback),
}

contextBridge.exposeInMainWorld('bozzDesktop', api)
