'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { setBackgroundActivity } = require('./backgroundActivity.cjs')

function fakeWindow() {
  const calls = []
  return {
    calls,
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      setBackgroundThrottling: (value) => calls.push(value),
    },
  }
}

test('keeps camera processing alive while the user has explicitly started gestures', () => {
  const win = fakeWindow()
  assert.deepEqual(setBackgroundActivity(win, { cameraActive: true, miniMode: false }), {
    ok: true,
    backgroundActive: true,
  })
  assert.deepEqual(win.calls, [false])
})

test('keeps the mini orb alive even when the camera is off', () => {
  const win = fakeWindow()
  assert.deepEqual(setBackgroundActivity(win, { cameraActive: false, miniMode: true }), {
    ok: true,
    backgroundActive: true,
  })
  assert.deepEqual(win.calls, [false])
})

test('restores normal throttling when camera and mini mode are both off', () => {
  const win = fakeWindow()
  assert.deepEqual(setBackgroundActivity(win, { cameraActive: false, miniMode: false }), {
    ok: true,
    backgroundActive: false,
  })
  assert.deepEqual(win.calls, [true])
})

test('does not touch a destroyed window or renderer', () => {
  assert.equal(setBackgroundActivity({ isDestroyed: () => true }).ok, false)
  const win = fakeWindow()
  win.webContents.isDestroyed = () => true
  assert.equal(setBackgroundActivity(win).ok, false)
  assert.deepEqual(win.calls, [])
})
