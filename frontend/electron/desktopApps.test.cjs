'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { WINDOWS_APPS, launchDesktopApp } = require('./desktopApps.cjs')

function fakeSpawn(calls, error = null) {
  return (executable, args, options) => {
    calls.push({ executable, args, options })
    if (error) throw error
    return { once() {}, unref() {} }
  }
}

test('Windows allowlist contains only the three documented app IDs', () => {
  assert.deepEqual(Object.keys(WINDOWS_APPS).sort(), ['calculator', 'notepad', 'paint'])
})

test('launch uses the fixed executable, empty args and shell:false', () => {
  const calls = []
  const result = launchDesktopApp('notepad', 'win32', fakeSpawn(calls))
  assert.deepEqual(result, { ok: true, appId: 'notepad' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].executable, 'notepad.exe')
  assert.deepEqual(calls[0].args, [])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.detached, true)
  assert.equal(calls[0].options.stdio, 'ignore')
})

test('rejects unsupported platforms without spawning', () => {
  const calls = []
  const result = launchDesktopApp('notepad', 'linux', fakeSpawn(calls))
  assert.equal(result.ok, false)
  assert.equal(calls.length, 0)
})

test('rejects unknown IDs and never forwards arbitrary command text', () => {
  const calls = []
  const result = launchDesktopApp('cmd.exe & whoami', 'win32', fakeSpawn(calls))
  assert.equal(result.ok, false)
  assert.equal(calls.length, 0)
})

test('converts process creation errors into a safe failure result', () => {
  const calls = []
  const result = launchDesktopApp('paint', 'win32', fakeSpawn(calls, new Error('spawn failed')))
  assert.equal(result.ok, false)
  assert.match(result.reason, /could not start/i)
  assert.equal(calls.length, 1)
})
