'use strict'

const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const PROCESS_APPS = Object.freeze({
  notepad: { appId: 'notepad', appName: 'Notepad' },
  mspaint: { appId: 'paint', appName: 'Paint' },
  calculatorapp: { appId: 'calculator', appName: 'Calculator' },
  calc: { appId: 'calculator', appName: 'Calculator' },
  msedge: { appId: 'edge', appName: 'Microsoft Edge' },
  chrome: { appId: 'chrome', appName: 'Google Chrome' },
  code: { appId: 'vscode', appName: 'Visual Studio Code' },
})

const POWERSHELL_LIST_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$names = @('notepad','mspaint','calculatorapp','calc','msedge','chrome','code')",
  "$items = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName.ToLowerInvariant() -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [PSCustomObject]@{ processId = [int]$_.Id; processName = [string]$_.ProcessName; handle = [long]$_.MainWindowHandle } })",
  'ConvertTo-Json -InputObject $items -Compress',
].join('; ')

const POWERSHELL_FOCUS_PREFIX = [
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BozzWindowApi { [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'",
  '$handle = [IntPtr]::new([Int64]',
].join('; ')

function parseWindowInventory(stdout) {
  let parsed
  try {
    parsed = JSON.parse(String(stdout || '[]').trim() || '[]')
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const seen = new Set()
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const processName = String(row.processName || '').toLowerCase()
    const app = PROCESS_APPS[processName]
    const processId = Number(row.processId)
    const handle = Number(row.handle)
    if (!app || !Number.isSafeInteger(processId) || processId <= 0) return []
    if (!Number.isSafeInteger(handle) || handle <= 0 || seen.has(processId)) return []
    seen.add(processId)
    return [{ processId, handle, ...app }]
  })
}

function createExternalWindowRegistry({
  platform = process.platform,
  execFileImpl = execFile,
  createId = randomUUID,
} = {}) {
  const handles = new Map()

  function runPowerShell(script) {
    return new Promise((resolve, reject) => {
      execFileImpl(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(String(stdout || '').trim())
        },
      )
    })
  }

  return {
    async list() {
      handles.clear()
      if (platform !== 'win32') {
        return { ok: false, windows: [], reason: 'External app discovery is available only on Windows.' }
      }
      try {
        const rows = parseWindowInventory(await runPowerShell(POWERSHELL_LIST_SCRIPT))
        const windows = rows.map((row) => {
          const id = createId()
          handles.set(id, { handle: row.handle, appId: row.appId, appName: row.appName })
          return { id, appId: row.appId, appName: row.appName }
        })
        return { ok: true, windows }
      } catch {
        handles.clear()
        return { ok: false, windows: [], reason: 'Could not inspect supported application windows.' }
      }
    },

    async focus(id) {
      if (platform !== 'win32') {
        return { ok: false, reason: 'External app focus is available only on Windows.' }
      }
      if (typeof id !== 'string' || !handles.has(id)) {
        return { ok: false, reason: 'That window is unknown or the inventory has expired.' }
      }
      const entry = handles.get(id)
      // A focus token is one-use. Refresh the inventory before another action.
      handles.delete(id)
      const handle = entry.handle
      const script = `${POWERSHELL_FOCUS_PREFIX}${handle}]); [void][BozzWindowApi]::ShowWindowAsync($handle, 9); if ([BozzWindowApi]::SetForegroundWindow($handle)) { 'OK' } else { 'DENIED' }`
      try {
        const output = await runPowerShell(script)
        return output === 'OK'
          ? { ok: true, appId: entry.appId, appName: entry.appName }
          : { ok: false, reason: 'Windows did not allow that application to come to the foreground.' }
      } catch {
        return { ok: false, reason: 'Could not focus that application window.' }
      }
    },
  }
}

module.exports = { PROCESS_APPS, POWERSHELL_LIST_SCRIPT, parseWindowInventory, createExternalWindowRegistry }
