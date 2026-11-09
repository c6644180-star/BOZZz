import { describe, expect, it } from 'vitest'
import { DiagnosticsStore, average, cpuAveragePercent, gestureLatencyAverage, ramAverageMb, sanitizeDiagnostics } from '../diagnostics'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.get(key) ?? null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('diagnostics store', () => {
  it('stores measured samples and counters only', () => {
    const storage = new MemoryStorage()
    let now = 1000
    const store = new DiagnosticsStore({ storage, now: () => now })
    store.recordGestureLatency(120)
    now = 1100
    store.recordGestureLatency(80)
    store.recordGesturePinch(true)
    store.recordGestureUncertain()
    store.recordGestureRejected()
    store.recordVoiceUncertain(true)
    store.recordCpu({ load: 0.4, ramMb: 150 })
    now = 1200
    store.recordModelAnalysis({ ms: 42, parts: 6, triangles: 12_000, warnings: 1 })
    const snapshot = store.snapshot()
    expect(gestureLatencyAverage(snapshot)).toBe(100)
    expect(cpuAveragePercent(snapshot, 'voice')).toBe(40)
    expect(ramAverageMb(snapshot)).toBe(150)
    expect(snapshot.gestures.uncertainEvents).toBe(1)
    expect(snapshot.gestures.rejectedEvents).toBe(1)
    expect(snapshot.gestures.shortPinches).toBe(1)
    expect(snapshot.voice.corrections).toBe(1)
    expect(snapshot.models.analysisMs).toEqual([42])
    expect(snapshot.models.lastParts).toBe(6)
    expect(snapshot.commandLog).toEqual([])
  })

  it('persists and reloads real values', () => {
    const storage = new MemoryStorage()
    const first = new DiagnosticsStore({ storage, now: () => 10 })
    first.recordPttLatency(640)
    first.recordVoiceConfidence(0.72)
    first.flush()
    const second = new DiagnosticsStore({ storage, now: () => 20 })
    expect(second.snapshot().voice.pttLatencies).toEqual([640])
    expect(second.snapshot().voice.confidenceSamples).toEqual([0.72])
  })

  it('resets and exports', () => {
    const store = new DiagnosticsStore({ storage: new MemoryStorage(), now: () => 5 })
    store.recordGestureLatency(50)
    store.logCommand('open notepad', false)
    expect(store.snapshot().commandLog).toHaveLength(1)
    expect(JSON.parse(store.exportJson()).gestures.latencySamples).toEqual([50])
    store.resetAll()
    expect(store.snapshot().gestures.latencySamples).toEqual([])
    expect(store.snapshot().commandLog).toEqual([])
  })

  it('sanitizes corrupted storage without inventing values', () => {
    const clean = sanitizeDiagnostics({
      gestures: { latencySamples: [10, 'bad', NaN], uncertainEvents: -3 },
      voice: null,
      models: { analysisMs: [5] },
      commandLog: [{ at: 1, text: 'hello', corrected: true }, { nope: true }],
    })
    expect(clean.gestures.latencySamples).toEqual([10])
    expect(clean.gestures.uncertainEvents).toBe(0)
    expect(clean.commandLog).toEqual([{ at: 1, text: 'hello', corrected: true }])
    expect(average([])).toBeNull()
  })
})
