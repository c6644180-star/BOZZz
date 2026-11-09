import type { CpuSample, DiagnosticsSnapshot, LoggedCommand, SubsystemCounters } from './types'

const STORAGE_KEY = 'bozz.adaptive.diagnostics.v1'
const MAX_SAMPLES = 240
const MAX_COMMAND_LOG = 100

export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numberArray(value: unknown, cap = MAX_SAMPLES): number[] {
  if (!Array.isArray(value)) return []
  return value.filter(finite).slice(-cap)
}

function cpuArray(value: unknown): CpuSample[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((sample): sample is CpuSample => Boolean(sample) && finite((sample as CpuSample).load) && finite((sample as CpuSample).at))
    .map((sample) => ({
      at: sample.at,
      load: Math.min(1, Math.max(0, sample.load)),
      ramMb: finite(sample.ramMb) ? sample.ramMb : null,
      source: 'main-thread' as const,
    }))
    .slice(-300)
}

function emptySnapshot(): DiagnosticsSnapshot {
  return {
    version: 1,
    gestures: {
      latencySamples: [],
      cpuSamples: [],
      uncertainEvents: 0,
      rejectedEvents: 0,
      falseActivations: 0,
      corrections: 0,
      sessions: 0,
      lastEventAt: null,
      pinchStarts: 0,
      shortPinches: 0,
    },
    voice: {
      latencySamples: [],
      cpuSamples: [],
      uncertainEvents: 0,
      rejectedEvents: 0,
      falseActivations: 0,
      corrections: 0,
      sessions: 0,
      lastEventAt: null,
      pttLatencies: [],
      confidenceSamples: [],
    },
    models: { analysisMs: [], lastParts: null, lastTriangles: null, warnings: 0, lastEventAt: null },
    commandLog: [],
  }
}

function sanitizeCounters(raw: unknown) {
  const value = (raw ?? {}) as Partial<SubsystemCounters>
  const counter = (input: unknown) => (finite(input) && input >= 0 ? Math.round(input) : 0)
  return {
    latencySamples: numberArray(value.latencySamples),
    cpuSamples: cpuArray(value.cpuSamples),
    uncertainEvents: counter(value.uncertainEvents),
    rejectedEvents: counter(value.rejectedEvents),
    falseActivations: counter(value.falseActivations),
    corrections: counter(value.corrections),
    sessions: counter(value.sessions),
    lastEventAt: finite(value.lastEventAt) ? value.lastEventAt : null,
  }
}

export function sanitizeDiagnostics(raw: unknown): DiagnosticsSnapshot {
  const input = (raw ?? {}) as Partial<DiagnosticsSnapshot>
  const gestures = { ...sanitizeCounters(input.gestures), pinchStarts: 0, shortPinches: 0 }
  const g = (input.gestures ?? {}) as Partial<DiagnosticsSnapshot['gestures']>
  gestures.pinchStarts = finite(g.pinchStarts) ? Math.max(0, Math.round(g.pinchStarts)) : 0
  gestures.shortPinches = finite(g.shortPinches) ? Math.max(0, Math.round(g.shortPinches)) : 0
  const voice = {
    ...sanitizeCounters(input.voice),
    pttLatencies: numberArray((input.voice as Partial<DiagnosticsSnapshot['voice']> | undefined)?.pttLatencies),
    confidenceSamples: numberArray((input.voice as Partial<DiagnosticsSnapshot['voice']> | undefined)?.confidenceSamples),
  }
  const m = (input.models ?? {}) as Partial<DiagnosticsSnapshot['models']>
  const models = {
    analysisMs: numberArray(m.analysisMs),
    lastParts: finite(m.lastParts) ? Math.round(m.lastParts) : null,
    lastTriangles: finite(m.lastTriangles) ? Math.round(m.lastTriangles) : null,
    warnings: finite(m.warnings) ? Math.max(0, Math.round(m.warnings)) : 0,
    lastEventAt: finite(m.lastEventAt) ? m.lastEventAt : null,
  }
  const commandLog: LoggedCommand[] = Array.isArray(input.commandLog)
    ? input.commandLog
        .filter((entry): entry is LoggedCommand => Boolean(entry) && typeof (entry as LoggedCommand).text === 'string')
        .map((entry) => ({ at: finite(entry.at) ? entry.at : Date.now(), text: entry.text.slice(0, 160), corrected: entry.corrected === true }))
        .slice(-MAX_COMMAND_LOG)
    : []
  return { version: 1, gestures, voice, models, commandLog }
}

export interface DiagnosticsStoreOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  now?: () => number
  maxSamples?: number
}

export class DiagnosticsStore {
  private snapshotValue: DiagnosticsSnapshot
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  private now: () => number
  private maxSamples: number
  private listeners = new Set<() => void>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: DiagnosticsStoreOptions = {}) {
    this.storage = options.storage === undefined
      ? (typeof localStorage === 'undefined' ? null : localStorage)
      : options.storage
    this.now = options.now ?? (() => Date.now())
    this.maxSamples = options.maxSamples ?? MAX_SAMPLES
    this.snapshotValue = this.read()
  }

  private read(): DiagnosticsSnapshot {
    if (!this.storage) return emptySnapshot()
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      return raw ? sanitizeDiagnostics(JSON.parse(raw)) : emptySnapshot()
    } catch {
      return emptySnapshot()
    }
  }

  snapshot(): DiagnosticsSnapshot {
    return this.snapshotValue
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private trim(values: number[]): number[] {
    return values.slice(-this.maxSamples)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, 600)
  }

  flush(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.snapshotValue))
    } catch {
      // quota or privacy mode; measurements stay in memory
    }
  }

  private touch(length: number | null): number {
    const at = this.now()
    if (length !== null) {
      this.snapshotValue.commandLog = this.snapshotValue.commandLog.slice(-length)
    }
    return at
  }

  recordGestureLatency(ms: number): void {
    if (!finite(ms) || ms < 0) return
    const g = this.snapshotValue.gestures
    g.latencySamples = this.trim([...g.latencySamples, Math.round(ms * 10) / 10])
    g.lastEventAt = this.touch(null)
    this.changed()
  }

  recordGesturePinch(short: boolean): void {
    const g = this.snapshotValue.gestures
    g.pinchStarts += 1
    if (short) g.shortPinches += 1
    g.lastEventAt = this.touch(null)
    this.changed()
  }

  recordGestureUncertain(): void {
    const g = this.snapshotValue.gestures
    g.uncertainEvents += 1
    g.lastEventAt = this.touch(null)
    this.changed()
  }

  recordGestureRejected(): void {
    const g = this.snapshotValue.gestures
    g.rejectedEvents += 1
    g.lastEventAt = this.touch(null)
    this.changed()
  }

  recordGestureFalseActivation(): void {
    const g = this.snapshotValue.gestures
    g.falseActivations += 1
    g.lastEventAt = this.touch(null)
    this.changed()
  }

  recordGestureSession(): void {
    const g = this.snapshotValue.gestures
    g.sessions += 1
    g.lastEventAt = this.touch(null)
    this.changed()
  }

  recordCpu(sample: { load: number; ramMb: number | null }): void {
    const entry: CpuSample = {
      at: this.now(),
      load: Math.min(1, Math.max(0, sample.load)),
      ramMb: finite(sample.ramMb) ? sample.ramMb : null,
      source: 'main-thread',
    }
    for (const key of ['gestures', 'voice'] as const) {
      const counters = this.snapshotValue[key]
      counters.cpuSamples = [...counters.cpuSamples, entry].slice(-300)
      counters.lastEventAt = entry.at
    }
    this.changed()
  }

  recordPttLatency(ms: number): void {
    if (!finite(ms) || ms < 0) return
    const v = this.snapshotValue.voice
    v.pttLatencies = this.trim([...v.pttLatencies, Math.round(ms)])
    v.latencySamples = this.trim([...v.latencySamples, Math.round(ms)])
    v.lastEventAt = this.touch(null)
    this.changed()
  }

  recordVoiceConfidence(value: number): void {
    if (!finite(value)) return
    const v = this.snapshotValue.voice
    v.confidenceSamples = this.trim([...v.confidenceSamples, Math.min(1, Math.max(0, value))])
    v.lastEventAt = this.touch(null)
    this.changed()
  }

  recordVoiceUncertain(wasCorrected: boolean): void {
    const v = this.snapshotValue.voice
    v.uncertainEvents += 1
    if (wasCorrected) v.corrections += 1
    v.lastEventAt = this.touch(null)
    this.changed()
  }

  recordVoiceFalseActivation(): void {
    const v = this.snapshotValue.voice
    v.falseActivations += 1
    v.lastEventAt = this.touch(null)
    this.changed()
  }

  recordVoiceSession(): void {
    const v = this.snapshotValue.voice
    v.sessions += 1
    v.lastEventAt = this.touch(null)
    this.changed()
  }

  recordModelAnalysis(input: { ms: number; parts: number; triangles: number | null; warnings: number }): void {
    const m = this.snapshotValue.models
    if (finite(input.ms) && input.ms >= 0) m.analysisMs = this.trim([...m.analysisMs, Math.round(input.ms)])
    m.lastParts = Number.isFinite(input.parts) ? Math.round(input.parts) : m.lastParts
    m.lastTriangles = finite(input.triangles) ? Math.round(input.triangles) : null
    m.warnings = Number.isFinite(input.warnings) ? Math.round(input.warnings) : m.warnings
    m.lastEventAt = this.now()
    this.changed()
  }

  logCommand(text: string, corrected: boolean): void {
    this.snapshotValue.commandLog = [
      ...this.snapshotValue.commandLog,
      { at: this.now(), text: text.slice(0, 160), corrected },
    ].slice(-MAX_COMMAND_LOG)
    this.changed()
  }

  resetAll(): void {
    this.snapshotValue = emptySnapshot()
    if (this.storage) {
      try {
        this.storage.removeItem(STORAGE_KEY)
      } catch {
        // best effort
      }
    }
    for (const listener of this.listeners) listener()
  }

  exportJson(): string {
    this.flush()
    return JSON.stringify(this.snapshotValue, null, 2)
  }
}

export const diagnostics = new DiagnosticsStore()

export function gestureLatencyAverage(snapshot = diagnostics.snapshot()): number | null {
  return average(snapshot.gestures.latencySamples)
}

export function voicePttAverage(snapshot = diagnostics.snapshot()): number | null {
  return average(snapshot.voice.pttLatencies)
}

export function cpuAveragePercent(snapshot = diagnostics.snapshot(), key: 'gestures' | 'voice' = 'voice'): number | null {
  const value = average(snapshot[key].cpuSamples.map((sample) => sample.load))
  return value === null ? null : Math.round(value * 100)
}

export function ramAverageMb(snapshot = diagnostics.snapshot()): number | null {
  const values = snapshot.voice.cpuSamples.map((sample) => sample.ramMb).filter(finite)
  const value = average(values)
  return value === null ? null : Math.round(value)
}
