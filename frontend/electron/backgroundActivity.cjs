'use strict'

function setBackgroundActivity(mainWindow, { cameraActive = false, miniMode = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'BOZZ window is unavailable.' }
  const contents = mainWindow.webContents
  if (!contents || contents.isDestroyed()) return { ok: false, reason: 'BOZZ renderer is unavailable.' }
  const keepRunning = cameraActive === true || miniMode === true
  contents.setBackgroundThrottling(!keepRunning)
  return { ok: true, backgroundActive: keepRunning }
}

module.exports = { setBackgroundActivity }
