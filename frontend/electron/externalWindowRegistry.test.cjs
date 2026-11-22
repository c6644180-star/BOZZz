'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseWindowInventory, createExternalWindowRegistry } = require('./externalWindowRegistry.cjs')

function fakeExec(stdout, error = null, calls = []) {
  return (file, args, options, callback) => {
    calls.push({ file, args, options })
    callback(error, stdout, '')
  }
}

test('inventory parser returns supported app labels without titles, handles or process IDs', () => {
  const rows = parseWindowInventory(JSON.stringify([
    { processId: 101, processName: 'chrome', handle: 9001, title: 'private browser tab' },
    { processId: 102, processName: 'notepad', handle: 9002, title: 'private document' },
    { processId: 103, processName: 'unknown-app', handle: 9003 },
    { processId: 104, processName: 'paint', handle: 'not-a-handle' },
  ]))
  assert.deepEqual(rows, [
    { processId: 101, handle: 9001, processName: 'chrome', appId: 'chrome', appName: 'Google Chrome' },
    { processId: 102, handle: 9002, processName: 'notepad', appId: 'notepad', appName: 'Notepad' },
  ])
})

test('list runs a fixed PowerShell command and exposes only opaque IDs and app labels', async () => {
  const calls = []
  const registry = createExternalWindowRegistry({
    platform: 'win32',
    createId: () => 'opaque-window-token',
    execFileImpl: fakeExec(JSON.stringify([{ processId: 22, processName: 'msedge', handle: 4444, title: 'secret tab' }]), null, calls),
  })
  const result = await registry.list()
  assert.equal(result.ok, true)
  assert.deepEqual(result.windows, [{ id: 'opaque-window-token', appId: 'edge', appName: 'Microsoft Edge' }])
  assert.equal(JSON.stringify(result).includes('4444'), false)
  assert.equal(JSON.stringify(result).includes('secret tab'), false)
  assert.equal(calls[0].file, 'powershell.exe')
  assert.equal(calls[0].options.windowsHide, true)
  assert.equal(calls[0].options.timeout, 5000)
  assert.equal(calls[0].options.shell, undefined)
})

test('discovery is unavailable off Windows and does not execute a process', async () => {
  let called = false
  const registry = createExternalWindowRegistry({ platform: 'linux', execFileImpl: () => { called = true } })
  const result = await registry.list()
  assert.equal(result.ok, false)
  assert.equal(called, false)
})

test('focus rejects guessed IDs and consumes a valid token after one use', async () => {
  const calls = []
  const registry = createExternalWindowRegistry({
    platform: 'win32',
    createId: () => 'known-token',
    execFileImpl: (file, args, options, callback) => {
      calls.push({ file, args, options })
      callback(null, calls.length === 1
        ? JSON.stringify([{ processId: 22, processName: 'notepad', handle: 4444 }])
        : 'OK', '')
    },
  })
  await registry.list()
  assert.equal((await registry.focus('guessed-token')).ok, false)
  assert.equal(calls.length, 1)
  assert.equal((await registry.focus('known-token')).ok, true)
  assert.equal(calls.length, 2)
  assert.match(calls[1].args.at(-1), /Get-Process -Id 22/)
  assert.match(calls[1].args.at(-1), /ProcessName -ne 'notepad'/)
  assert.match(calls[1].args.at(-1), /\[Int64\]4444/)
  assert.equal((await registry.focus('known-token')).ok, false)
  assert.equal(calls.length, 2)
})

test('malformed handles are filtered and cannot enter the focus command', async () => {
  const calls = []
  const registry = createExternalWindowRegistry({
    platform: 'win32',
    execFileImpl: fakeExec(JSON.stringify([{ processId: 22, processName: 'chrome', handle: '4444; whoami' }]), null, calls),
  })
  const result = await registry.list()
  assert.deepEqual(result.windows, [])
  assert.equal((await registry.focus('anything')).ok, false)
  assert.equal(calls.length, 1)
})

test('PowerShell failures produce safe results without retrying', async () => {
  let count = 0
  const registry = createExternalWindowRegistry({
    platform: 'win32',
    execFileImpl: (_file, _args, _options, callback) => { count += 1; callback(new Error('failed'), '', '') },
  })
  const result = await registry.list()
  assert.equal(result.ok, false)
  assert.equal(result.windows.length, 0)
  assert.equal(count, 1)
})
