'use strict'

const { spawn } = require('node:child_process')

// Fixed executable allowlist. No user-supplied command, arguments or shell.
const WINDOWS_APPS = Object.freeze({
  calculator: 'calc.exe',
  notepad: 'notepad.exe',
  paint: 'mspaint.exe',
})

function launchDesktopApp(appId, platform = process.platform, spawnProcess = spawn) {
  if (platform !== 'win32') {
    return { ok: false, reason: 'This launcher is currently supported on Windows only.' }
  }
  const executable = WINDOWS_APPS[appId]
  if (!executable) {
    return { ok: false, reason: 'This application is not on the BOZZ allowlist.' }
  }
  try {
    const child = spawnProcess(executable, [], { detached: true, stdio: 'ignore', windowsHide: false, shell: false })
    child.once?.('error', () => {})
    child.unref?.()
    return { ok: true, appId }
  } catch {
    return { ok: false, reason: 'Windows could not start the selected application.' }
  }
}

module.exports = { WINDOWS_APPS, launchDesktopApp }
