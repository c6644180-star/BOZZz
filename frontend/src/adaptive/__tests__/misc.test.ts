import { describe, expect, it } from 'vitest'
import { UndoStack } from '../undo'
import { classifyLighting, landmarkCoverage } from '../lighting'
import { CpuMonitor, computeMainThreadLoad } from '../cpu'
import { canOpenMicrophone, canStartBackgroundListening, pttLatencyMs, resolveVoiceMode, voiceModeNeedsBackgroundListening } from '../voice'
import { getWakeWordEngine, startWakeWordEngineSafely, wakeWordStatus } from '../wakeWord'

describe('undo stack', () => {
  it('undoes in reverse order and reports the label', () => {
    const stack = new UndoStack(2)
    const values: string[] = []
    stack.push('expand folder', () => values.push('collapse'))
    stack.push('reset orb', () => values.push('restore orb'))
    stack.push('explode', () => values.push('reassemble'))
    expect(stack.size()).toBe(2)
    expect(stack.undoLast()).toBe('explode')
    expect(stack.undoLast()).toBe('reset orb')
    expect(values).toEqual(['reassemble', 'restore orb'])
    expect(stack.undoLast()).toBeNull()
  })
})

describe('lighting check', () => {
  it('returns not measured without a frame', () => {
    expect(classifyLighting(null).level).toBe('unknown')
    expect(classifyLighting(null).measured).toBe(false)
  })

  it('classifies measured brightness without faking a value', () => {
    expect(classifyLighting({ brightness: 0.05, contrast: 0.2, coverage: 1, score: 0.9 }).level).toBe('dark')
    expect(classifyLighting({ brightness: 0.5, contrast: 0.2, coverage: 1, score: 0.9 }).level).toBe('ok')
    expect(classifyLighting({ brightness: 0.5, contrast: 0.2, coverage: 0.3, score: 0.9 }).level).toBe('out-of-frame')
    expect(classifyLighting({ brightness: 0.5, contrast: 0.2, coverage: 1, score: 0.2 }).level).toBe('weak-tracking')
  })

  it('measures how much of the hand is inside the frame', () => {
    expect(landmarkCoverage([])).toBeNull()
    expect(landmarkCoverage([{ x: 0.5, y: 0.5 }, { x: 0.99, y: 0.5 }])).toBe(0.5)
  })
})

describe('cpu monitor', () => {
  it('derives load from real timer drift only', () => {
    expect(computeMainThreadLoad(1000, 1000)).toBe(0)
    expect(computeMainThreadLoad(1500, 1000)).toBe(0.5)
    expect(computeMainThreadLoad(NaN, 1000)).toBe(0)
    const monitor = new CpuMonitor({ intervalMs: 1000, now: () => 0 })
    monitor.record(1000)
    monitor.record(2500)
    expect(monitor.averagePercent()).toBe(25)
    expect(monitor.samples()).toHaveLength(2)
  })

  it('requires enough covered samples before claiming sustained load', () => {
    const monitor = new CpuMonitor({ intervalMs: 1000 })
    for (let index = 0; index < 4; index++) monitor.record(index * 1000)
    expect(monitor.sustainedAbove(85, 10)).toBe(false)
  })
})

describe('voice modes', () => {
  it('migrates the old wake-word toggle and defaults to push-to-talk', () => {
    expect(resolveVoiceMode({})).toBe('push-to-talk')
    expect(resolveVoiceMode({ wakeWord: true })).toBe('wake-word')
    expect(resolveVoiceMode({ voiceMode: 'manual', wakeWord: true })).toBe('manual')
  })

  it('measures push-to-talk latency from real timestamps only', () => {
    expect(pttLatencyMs(1000, 1420)).toBe(420)
    expect(pttLatencyMs(1000, 900)).toBeNull()
    expect(pttLatencyMs(NaN, 900)).toBeNull()
  })

  it('requires explicit consent, an installed local engine, and OS permission before background listening', () => {
    const base = { mode: 'wake-word' as const, consentGranted: true, engineAvailable: true, osPermissionGranted: true }
    expect(canStartBackgroundListening({ ...base, consentGranted: false })).toBe(false)
    expect(canStartBackgroundListening({ ...base, engineAvailable: false })).toBe(false)
    expect(canStartBackgroundListening({ ...base, osPermissionGranted: false })).toBe(false)
    expect(canStartBackgroundListening({ ...base, mode: 'push-to-talk' })).toBe(false)
    expect(canStartBackgroundListening(base)).toBe(true)
  })

  it('keeps the microphone closed until an explicit action outside wake-word mode', () => {
    expect(canOpenMicrophone('push-to-talk', false)).toBe(false)
    expect(canOpenMicrophone('manual', false)).toBe(false)
    expect(canOpenMicrophone('wake-word', false)).toBe(false)
    expect(canOpenMicrophone('wake-word', false, true)).toBe(true)
    expect(canOpenMicrophone('wake-word', false, false)).toBe(false)
    expect(canOpenMicrophone('push-to-talk', true)).toBe(true)
    expect(canOpenMicrophone('manual', true)).toBe(true)
    expect(voiceModeNeedsBackgroundListening('wake-word')).toBe(true)
    expect(voiceModeNeedsBackgroundListening('push-to-talk')).toBe(false)
  })
})


  it('refuses to start a local engine unless every background-listening gate is satisfied', async () => {
    let starts = 0
    const engine = {
      id: 'test-local', label: 'Test local', offline: true, available: true, reason: null,
      start: async () => { starts += 1; return { ok: true, detail: 'started' } },
      stop: () => {},
    }
    const base = { mode: 'wake-word' as const, consentGranted: true, osPermissionGranted: true }
    expect((await startWakeWordEngineSafely(engine, { ...base, consentGranted: false }, () => {})).ok).toBe(false)
    expect((await startWakeWordEngineSafely(engine, { ...base, osPermissionGranted: false }, () => {})).ok).toBe(false)
    expect((await startWakeWordEngineSafely(engine, { ...base, mode: 'manual' }, () => {})).ok).toBe(false)
    expect(starts).toBe(0)
    expect((await startWakeWordEngineSafely(engine, base, () => {})).ok).toBe(true)
    expect(starts).toBe(1)
  })

describe('wake word status', () => {
  it('is honest that no offline engine is installed', async () => {
    const engine = getWakeWordEngine()
    expect(engine.available).toBe(false)
    const started = await engine.start(() => {})
    expect(started.ok).toBe(false)
    expect(wakeWordStatus().installed).toBe(false)
    expect(wakeWordStatus().options.length).toBeGreaterThan(0)
  })
})
