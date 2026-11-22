'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { snapshotManagedWindows, focusManagedWindow } = require('./windowRegistry.cjs')

function fakeWindow(overrides = {}) {
  const calls = []
  return {
    calls,
    isDestroyed: () => false,
    getTitle: () => 'BOZZ Test',
    isVisible: () => true,
    isFocused: () => false,
    isMinimized: () => false,
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    restore: () => calls.push('restore'),
    ...overrides,
  }
}

test('snapshot includes only available BOZZ-managed windows', () => {
  const main = fakeWindow()
  const mini = fakeWindow({ isDestroyed: () => true })
  const rows = snapshotManagedWindows({ mainWindow: main, miniWindow: mini })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'main')
  assert.equal(rows[0].title, 'BOZZ Test')
})

test('focus restores a minimized managed window before showing and focusing', () => {
  const win = fakeWindow({ isMinimized: () => true })
  const result = focusManagedWindow('main', { mainWindow: win, miniWindow: null })
  assert.deepEqual(result, { ok: true, id: 'main' })
  assert.deepEqual(win.calls, ['restore', 'show', 'focus'])
})

test('focus rejects unknown ids and never accepts arbitrary window handles', () => {
  const win = fakeWindow()
  assert.equal(focusManagedWindow('powershell', { mainWindow: win }).ok, false)
  assert.deepEqual(win.calls, [])
})

test('focus safely reports missing managed windows', () => {
  assert.equal(focusManagedWindow('mini', { mainWindow: null, miniWindow: null }).ok, false)
})
