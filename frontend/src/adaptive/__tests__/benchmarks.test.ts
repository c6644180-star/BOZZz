import { describe, expect, it } from 'vitest'
import {
  evaluateGestureSuite,
  evaluateModelIntelligence,
  evaluateVoiceBenchmark,
  overallStatus,
  summarizeGestureSuite,
} from '../benchmarks'

describe('gesture suite status', () => {
  const thresholds = { pinchHitRate: 0.9, falseTriggersPerMinute: 2, latencyMs: 150 }

  it('reports not measured without a suite', () => {
    const status = evaluateGestureSuite(null, thresholds)
    expect(status.status).toBe('not-measured')
    expect(status.metrics.every((metric) => !metric.measured)).toBe(true)
  })

  it('passes only from measured results that meet every target', () => {
    const trials = [
      ...Array.from({ length: 20 }, (_, index) => ({
        target: 'pinch' as const,
        hit: index < 18,
        latencyMs: 110,
      })),
      { target: 'double_tap' as const, hit: true, latencyMs: 130 },
    ]
    const result = summarizeGestureSuite({
      id: 'suite-1',
      createdAt: 1_700_000_000_000,
      quality: 'medium',
      trials,
      idleSeconds: 60,
      falseTriggers: 1,
    })
    const status = evaluateGestureSuite(result, thresholds)
    expect(status.status).toBe('pass')
    expect(status.metrics.find((metric) => metric.label === 'Pinch hit rate')?.value).toContain('18/20')
  })

  it('needs tuning when latency misses the target', () => {
    const result = summarizeGestureSuite({
      id: 'suite-2',
      createdAt: 1,
      quality: 'medium',
      trials: Array.from({ length: 10 }, () => ({ target: 'pinch' as const, hit: true, latencyMs: 210 })),
      idleSeconds: 60,
      falseTriggers: 0,
    })
    expect(evaluateGestureSuite(result, thresholds).status).toBe('needs-tuning')
  })

  it('is not measured when the idle test never ran', () => {
    const result = summarizeGestureSuite({
      id: 'suite-3',
      createdAt: 1,
      quality: 'medium',
      trials: Array.from({ length: 10 }, () => ({ target: 'pinch' as const, hit: true, latencyMs: 90 })),
      idleSeconds: 0,
      falseTriggers: 0,
    })
    expect(result.idle.perMinute).toBeNull()
    expect(evaluateGestureSuite(result, thresholds).status).toBe('not-measured')
  })
})

describe('voice benchmark status', () => {
  const thresholds = { pttLatencyMs: 1500, accuracy: 0.85, falseActivationsPerHour: 1 }

  it('passes with real prompted results', () => {
    const status = evaluateVoiceBenchmark(
      {
        version: 1,
        id: 'voice-1',
        createdAt: 1,
        wake: { engineInstalled: false, seconds: 0, cpuPercent: null, ramMb: null, detail: 'not installed' },
        ptt: { samples: 6, avgLatencyMs: 820 },
        falseActivations: { seconds: 60, count: 0, perHour: 0 },
        accuracy: {
          english: { prompted: 20, correct: 17, accuracy: 0.85 },
          tanglish: { prompted: 20, correct: 15, accuracy: 0.75 },
        },
      },
      thresholds,
      false,
    )
    expect(status.status).toBe('pass')
    expect(status.metrics.find((metric) => metric.label === 'Wake-word CPU / RAM')?.value).toMatch(/no offline wake-word engine is installed/i)
  })

  it('does not claim wake-word CPU without an engine', () => {
    const status = evaluateVoiceBenchmark(
      {
        version: 1,
        id: 'voice-2',
        createdAt: 1,
        wake: { engineInstalled: false, seconds: 60, cpuPercent: 12, ramMb: 40, detail: '' },
        ptt: { samples: 1, avgLatencyMs: 700 },
        falseActivations: { seconds: 60, count: 0, perHour: 0 },
        accuracy: { english: { prompted: 20, correct: 20, accuracy: 1 }, tanglish: { prompted: 0, correct: 0, accuracy: null } },
      },
      thresholds,
      false,
    )
    expect(status.metrics.find((metric) => metric.label === 'Wake-word CPU / RAM')?.measured).toBe(false)
  })
})

describe('model intelligence status', () => {
  const thresholds = { analysisMs: 2000, maxTriangles: 200_000 }

  it('passes when generic names are confirmed and analysis is measured', () => {
    const status = evaluateModelIntelligence(
      {
        createdAt: 1,
        parts: 8,
        triangles: 1000,
        genericParts: 4,
        confirmedLabels: 4,
        analysisMs: 120,
        warnings: 0,
      },
      thresholds,
    )
    expect(status.status).toBe('pass')
  })

  it('needs tuning while generic names stay unconfirmed', () => {
    const status = evaluateModelIntelligence(
      { createdAt: 1, parts: 8, triangles: 1000, genericParts: 4, confirmedLabels: 1, analysisMs: 120, warnings: 0 },
      thresholds,
    )
    expect(status.status).toBe('needs-tuning')
  })

  it('never reports production readiness without a model', () => {
    expect(evaluateModelIntelligence(null, thresholds).status).toBe('not-measured')
  })

  it('overall status is strict about missing required metrics', () => {
    expect(overallStatus([
      { label: 'a', value: '', measured: true, pass: true, required: true },
      { label: 'b', value: '', measured: false, pass: null, required: true },
    ])).toBe('not-measured')
  })
})
