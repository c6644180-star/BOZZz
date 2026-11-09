'use strict'

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, powerMonitor, screen } = require('electron')
const path = require('node:path')
const { initialState, reduceMode } = require('./mini/state.cjs')
const {
  isValidMode,
  sanitizeMiniAction,
  sanitizeMiniConfig,
  sanitizeMiniState,
} = require('./mini/ipc.cjs')
const { clampToWorkArea, dockPoint, randomTarget, stepToward } = require('./mini/wander.cjs')
const { computePauseReasons, shouldPauseAnimation } = require('./mini/pause.cjs')

const WINDOW_SIZES = {
  small: { width: 240, height: 250 },
  medium: { width: 320, height: 320 },
}
const MINI_MARGIN = 16
const DRAG_PAUSE_MS = 60000
const WANDER_TICK_MS = 100
const PAUSE_CHECK_MS = 500

function resolveAppUrl() {
  const candidate = process.env.BOZZ_APP_URL || 'http://localhost:5173'
  try {
    const url = new URL(candidate)
    // Only the local app may be loaded into a window. A remote URL is ignored.
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return url.origin
    }
  } catch {
    // Fall through to the default local dev server.
  }
  return 'http://localhost:5173'
}

const APP_URL = resolveAppUrl()

let mainWindow = null
let miniWindow = null
let modeState = initialState()
let lastState = sanitizeMiniState({}) || {
  orbState: 'idle',
  caption: '',
  listening: false,
  micAvailable: false,
  cameraActive: false,
  desktopOn: false,
  emergency: false,
  approval: null,
}
let miniConfig = sanitizeMiniConfig({})
let wanderTimer = null
let wanderTarget = null
let wanderMove = null
let wanderNextAt = 0
let manualPauseUntil = 0
let dragging = null
let pauseCheckedAt = 0
let pauseReasons = []
let lastPauseKey = ''
let emergencyShortcutRegistered = false

function isFromMain(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents)
}

function isFromMini(event) {
  return Boolean(miniWindow && !miniWindow.isDestroyed() && event.sender === miniWindow.webContents)
}

function sendMini(channel, payload) {
  if (!miniWindow || miniWindow.isDestroyed()) return
  miniWindow.webContents.send(channel, payload)
}

function sendMain(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function forwardMiniAction(action) {
  sendMain('mini:action', action)
}

function miniSize() {
  const preset = WINDOW_SIZES[miniConfig.size] || WINDOW_SIZES.small
  return { width: preset.width, height: preset.height }
}

function targetDisplay() {
  if (miniConfig.monitor === 'primary') return screen.getPrimaryDisplay()
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function initialPosition() {
  const size = miniSize()
  const area = targetDisplay().workArea
  if (miniConfig.dock !== 'free') {
    return dockPoint(miniConfig.dock, area, size.width, size.height, MINI_MARGIN)
  }
  return clampToWorkArea(
    area.x + area.width - size.width - MINI_MARGIN,
    area.y + area.height - size.height - MINI_MARGIN,
    size.width,
    size.height,
    area,
    MINI_MARGIN,
  )
}

function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'BOZZ',
    backgroundColor: '#080B12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  hardenWindow(mainWindow)
  mainWindow.loadURL(APP_URL)
  mainWindow.once('ready-to-show', () => {
    // ready-to-show can arrive after BOZZ_START_MINI has already entered mini
    // mode; showing here would leave both windows visible.
    if (modeState.mode !== 'mini') mainWindow?.show()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy()
  })

  if (process.env.BOZZ_START_MINI === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => enterMini(), 800)
    })
  }
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) return
  const size = miniSize()
  const point = initialPosition()
  miniWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: point.x,
    y: point.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'BOZZ Mini Orb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  hardenWindow(miniWindow)
  miniWindow.setAlwaysOnTop(true, 'screen-saver')
  miniWindow.setSkipTaskbar(true)
  miniWindow.setIgnoreMouseEvents(true, { forward: true })
  miniWindow.setOpacity(miniConfig.opacity)
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  miniWindow.loadURL(`${APP_URL}/mini`)

  miniWindow.once('ready-to-show', () => {
    if (!miniWindow || miniWindow.isDestroyed()) return
    miniWindow.showInactive()
    miniWindow.setOpacity(miniConfig.opacity)
    miniWindow.webContents.send('mini:config', miniConfig)
    miniWindow.webContents.send('mini:state', lastState)
    miniWindow.webContents.send('mini:pause', {
      paused: shouldPauseAnimation(pauseReasons),
      reasons: pauseReasons,
    })
    miniWindow.webContents.send('mini:mode', { mode: 'mini' })
  })

  miniWindow.on('closed', () => {
    miniWindow = null
    stopWander()
    if (modeState.mode === 'mini') {
      modeState = reduceMode(modeState, { type: 'exit-mini' })
      mainWindow?.webContents.setBackgroundThrottling(true)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.webContents.send('mini:mode', { mode: 'full' })
      }
    }
  })
}

function enterMini() {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (modeState.mode === 'mini') return true
  modeState = reduceMode(modeState, { type: 'enter-mini' })
  // The backend registers Ctrl+Alt+Q only while desktop control is on. In mini
  // mode the camera can be running with desktop control off, so try to add a
  // global stop here. Registration fails harmlessly when the backend owns it.
  if (!emergencyShortcutRegistered) {
    emergencyShortcutRegistered = globalShortcut.register('CommandOrControl+Alt+Q', () => {
      forwardMiniAction({ type: 'emergency-stop' })
    })
  }
  // Keeps timers alive while hidden so voice, speech playback and the gesture
  // tunnel keep receiving events. The hidden window still stops painting.
  mainWindow.webContents.setBackgroundThrottling(false)
  mainWindow.hide()
  createMiniWindow()
  startWander()
  sendMain('mini:mode', { mode: 'mini' })
  return true
}

function exitMini() {
  if (modeState.mode !== 'mini') return
  modeState = reduceMode(modeState, { type: 'exit-mini' })
  if (emergencyShortcutRegistered) {
    globalShortcut.unregister('CommandOrControl+Alt+Q')
    emergencyShortcutRegistered = false
  }
  stopWander()
  const win = miniWindow
  miniWindow = null
  if (win && !win.isDestroyed()) win.destroy()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setBackgroundThrottling(true)
    mainWindow.show()
    mainWindow.focus()
    sendMain('mini:mode', { mode: 'full' })
  }
}

function toggleMini() {
  if (modeState.mode === 'mini') exitMini()
  else enterMini()
}

function currentPauseReasons() {
  return computePauseReasons({
    wanderEnabled: miniConfig.dock === 'free' && miniConfig.wander,
    manualPause: Date.now() < manualPauseUntil,
    approvalPending: Boolean(lastState.approval),
    fullscreen: Boolean(
      (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) ||
        (miniWindow && !miniWindow.isDestroyed() && miniWindow.isFullScreen()),
    ),
    onBattery: powerMonitor.isOnBatteryPower(),
    pauseOnBattery: miniConfig.pauseOnBattery,
    busy: lastState.orbState === 'speaking' || lastState.listening,
    idleSeconds: powerMonitor.getSystemIdleTime(),
  })
}

function startWander() {
  if (wanderTimer) return
  pauseCheckedAt = 0
  lastPauseKey = ''
  wanderNextAt = 0
  wanderTimer = setInterval(wanderTick, WANDER_TICK_MS)
}

function stopWander() {
  if (wanderTimer) clearInterval(wanderTimer)
  wanderTimer = null
  wanderTarget = null
  wanderMove = null
  dragging = null
}

function wanderTick() {
  if (!miniWindow || miniWindow.isDestroyed()) return
  const now = Date.now()
  if (now - pauseCheckedAt >= PAUSE_CHECK_MS) {
    pauseCheckedAt = now
    pauseReasons = currentPauseReasons()
    const key = pauseReasons.join(',')
    if (key !== lastPauseKey) {
      lastPauseKey = key
      sendMini('mini:pause', { paused: shouldPauseAnimation(pauseReasons), reasons: pauseReasons })
    }
  }
  if (pauseReasons.length > 0) {
    wanderTarget = null
    wanderMove = null
    return
  }
  if (now < manualPauseUntil) return

  if (!wanderTarget) {
    if (now < wanderNextAt) return
    const bounds = miniWindow.getBounds()
    const size = miniSize()
    const target = randomTarget(targetDisplay().workArea, size.width, size.height, MINI_MARGIN)
    wanderMove = {
      from: { x: bounds.x, y: bounds.y },
      startedAt: now,
      duration: miniConfig.wanderSpeed === 'slow' ? 9000 : 5000,
    }
    wanderTarget = target
    return
  }

  const progress = (now - wanderMove.startedAt) / wanderMove.duration
  const point = stepToward(wanderMove.from, wanderTarget, progress)
  const bounds = miniWindow.getBounds()
  if (point.x !== bounds.x || point.y !== bounds.y) miniWindow.setPosition(point.x, point.y)
  if (progress >= 1) {
    wanderTarget = null
    wanderMove = null
    wanderNextAt = now + (miniConfig.wanderSpeed === 'slow' ? 7000 : 4000)
  }
}

function applyMiniConfig(next) {
  miniConfig = next
  if (!miniWindow || miniWindow.isDestroyed()) return
  const size = miniSize()
  miniWindow.setSize(size.width, size.height, false)
  miniWindow.setOpacity(miniConfig.opacity)
  const area = targetDisplay().workArea
  const point =
    miniConfig.dock === 'free'
      ? (() => {
          const bounds = miniWindow.getBounds()
          return clampToWorkArea(bounds.x, bounds.y, size.width, size.height, area, MINI_MARGIN)
        })()
      : dockPoint(miniConfig.dock, area, size.width, size.height, MINI_MARGIN)
  miniWindow.setPosition(point.x, point.y)
  wanderTarget = null
  wanderMove = null
  wanderNextAt = 0
  pauseCheckedAt = 0
  sendMini('mini:config', miniConfig)
}

function showMiniMenu() {
  if (!miniWindow || miniWindow.isDestroyed()) return
  Menu.buildFromTemplate([
    { label: 'Open full mode', click: () => exitMini() },
    { type: 'separator' },
    {
      label: 'Mute microphone',
      enabled: lastState.listening,
      click: () => forwardMiniAction({ type: 'mute' }),
    },
    {
      label: 'Stop speaking',
      enabled: lastState.orbState === 'speaking',
      click: () => forwardMiniAction({ type: 'stop-speak' }),
    },
    { type: 'separator' },
    { label: 'Quit BOZZ', click: () => app.quit() },
  ]).popup({ window: miniWindow })
}

ipcMain.on('mini:set-mode', (event, mode) => {
  if (!isFromMain(event) || !isValidMode(mode)) return
  if (mode === 'mini') enterMini()
  else exitMini()
})

ipcMain.handle('mini:get-mode', (event) => {
  if (!isFromMain(event) && !isFromMini(event)) return 'full'
  return modeState.mode
})

ipcMain.on('mini:open-full', (event) => {
  if (!isFromMini(event)) return
  exitMini()
})

ipcMain.on('mini:quit', (event) => {
  if (!isFromMain(event) && !isFromMini(event)) return
  app.quit()
})

ipcMain.on('mini:state', (event, raw) => {
  if (!isFromMain(event)) return
  const state = sanitizeMiniState(raw)
  if (!state) return
  lastState = state
  modeState = reduceMode(modeState, { type: 'mic', value: state.listening })
  modeState = reduceMode(modeState, { type: 'camera', value: state.cameraActive })
  sendMini('mini:state', state)
})

ipcMain.on('mini:config', (event, raw) => {
  if (!isFromMain(event)) return
  applyMiniConfig(sanitizeMiniConfig(raw))
})

ipcMain.on('mini:action', (event, raw) => {
  if (!isFromMini(event)) return
  const action = sanitizeMiniAction(raw)
  if (!action) return
  switch (action.type) {
    case 'hover':
      miniWindow?.setIgnoreMouseEvents(!action.value, { forward: true })
      return
    case 'drag-start': {
      if (!miniWindow) return
      const bounds = miniWindow.getBounds()
      dragging = {
        offsetX: action.screenX - bounds.x,
        offsetY: action.screenY - bounds.y,
      }
      return
    }
    case 'drag-move': {
      if (!dragging || !miniWindow) return
      const size = miniSize()
      const area = targetDisplay().workArea
      const point = clampToWorkArea(
        action.screenX - dragging.offsetX,
        action.screenY - dragging.offsetY,
        size.width,
        size.height,
        area,
        MINI_MARGIN,
      )
      miniWindow.setPosition(point.x, point.y)
      return
    }
    case 'drag-end':
      dragging = null
      if (action.moved) {
        manualPauseUntil = Date.now() + DRAG_PAUSE_MS
        wanderTarget = null
        wanderMove = null
      }
      return
    case 'expand':
      exitMini()
      return
    case 'quit':
      app.quit()
      return
    case 'menu':
      showMiniMenu()
      return
    default:
      forwardMiniAction(action)
  }
})

app.whenReady().then(() => {
  createMainWindow()

  const toggleRegistered = globalShortcut.register('CommandOrControl+Alt+M', toggleMini)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else if (modeState.mode === 'mini') miniWindow?.showInactive()
    else mainWindow?.show()
  })

  if (!toggleRegistered) {
    console.warn('[mini] Ctrl+Alt+M is already in use by another app.')
  }
})

app.on('before-quit', () => {
  stopWander()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
