import { average } from './diagnostics'
import type { ReliabilityStatus, StatusMetric } from './types'

export const GESTURE_SUITE_TARGETS = ['pinch', 'tap', 'double_tap', 'pinch_hold', 'point', 'flick', 'open_palm'] as const
export type GestureSuiteTarget = (typeof GESTURE_SUITE_TARGETS)[number]

export const GESTURE_TARGET_COPY: Record<GestureSuiteTarget, string> = {
  pinch: 'Pinch',
  tap: 'Tap (short pinch)',
  double_tap: 'Double tap',
  pinch_hold: 'Pinch and hold',
  point: 'Point',
  flick: 'Flick',
  open_palm: 'Open palm',
}

export interface GestureSuiteTrial {
  target: GestureSuiteTarget
  hit: boolean
  latencyMs: number | null
}

export interface GestureSuiteResult {
  version: 1
  id: string
  createdAt: number
  quality: string
  perGesture: Record<string, {
    trials: number
    hits: number
    hitRate: number | null
    avgLatencyMs: number | null
  }>
  idle: { seconds: number; falseTriggers: number; perMinute: number | null }
}

const GESTURE_SUITE_KEY = 'bozz.adaptive.gestureSuite.v1'
const VOICE_BENCH_KEY = 'bozz.adaptive.voiceBenchmark.v1'

export function summarizeGestureSuite(input: {
  id: string
  createdAt: number
  quality: string
  trials: GestureSuiteTrial[]
  idleSeconds: number
  falseTriggers: number
}): GestureSuiteResult {
  const perGesture: GestureSuiteResult['perGesture'] = {}
  for (const target of GESTURE_SUITE_TARGETS) {
    const trials = input.trials.filter((trial) => trial.target === target)
    const hits = trials.filter((trial) => trial.hit).length
    const latencies = trials.map((trial) => trial.latencyMs).filter((value): value is number => value !== null && Number.isFinite(value))
    perGesture[target] = {
      trials: trials.length,
      hits,
      hitRate: trials.length > 0 ? hits / trials.length : null,
      avgLatencyMs: average(latencies) === null ? null : Math.round(average(latencies) as number),
    }
  }
  const idleSeconds = Math.max(0, input.idleSeconds)
  return {
    version: 1,
    id: input.id,
    createdAt: input.createdAt,
    quality: input.quality,
    perGesture,
    idle: {
      seconds: idleSeconds,
      falseTriggers: Math.max(0, input.falseTriggers),
      perMinute: idleSeconds > 0 ? (Math.max(0, input.falseTriggers) / idleSeconds) * 60 : null,
    },
  }
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Not measured yet' : `${Math.round(value * 100)}%`
}

interface MaybeMetric extends StatusMetric {
  required: boolean
}

export function overallStatus(metrics: MaybeMetric[]): 'pass' | 'needs-tuning' | 'not-measured' {
  const required = metrics.filter((metric) => metric.required)
  const measured = required.filter((metric) => metric.measured)
  if (measured.some((metric) => metric.pass === false)) return 'needs-tuning'
  if (measured.length < required.length) return 'not-measured'
  return 'pass'
}

function strip(metrics: MaybeMetric[]): StatusMetric[] {
  return metrics.map(({ required: _required, ...metric }) => metric)
}

export function evaluateGestureSuite(
  result: GestureSuiteResult | null,
  thresholds: { pinchHitRate: number; falseTriggersPerMinute: number; latencyMs: number },
): ReliabilityStatus {
  if (!result) {
    return {
      id: 'gestures',
      label: 'Gestures',
      status: 'not-measured',
      detail: 'No gesture test suite has been run yet.',
      metrics: [
        { label: 'Pinch hit rate', value: 'Not measured yet', measured: false, pass: null },
        { label: 'False triggers (idle)', value: 'Not measured yet', measured: false, pass: null },
        { label: 'Camera → event latency', value: 'Not measured yet', measured: false, pass: null },
      ],
    }
  }
  const pinchHit = result.perGesture.pinch?.hitRate ?? null
  const pinchTrials = result.perGesture.pinch?.trials ?? 0
  const latencyValues = Object.values(result.perGesture)
    .map((entry) => entry.avgLatencyMs)
    .filter((value): value is number => value !== null)
  const latency = average(latencyValues)
  const falseRate = result.idle.perMinute
  const metrics: MaybeMetric[] = [
    {
      label: 'Pinch hit rate',
      value: pinchHit === null ? 'Not measured yet' : `${formatPercent(pinchHit)} (${result.perGesture.pinch.hits}/${pinchTrials} trials)`,
      measured: pinchHit !== null,
      pass: pinchHit === null ? null : pinchHit >= thresholds.pinchHitRate,
      required: true,
    },
    {
      label: 'False triggers while idle',
      value: falseRate === null
        ? 'Not measured yet'
        : `${falseRate.toFixed(2)}/min (${result.idle.falseTriggers} in ${Math.round(result.idle.seconds)} s)`,
      measured: falseRate !== null,
      pass: falseRate === null ? null : falseRate < thresholds.falseTriggersPerMinute,
      required: true,
    },
    {
      label: 'Camera → event latency',
      value: latency === null ? 'Not measured yet' : `${Math.round(latency)} ms average`,
      measured: latency !== null,
      pass: latency === null ? null : latency < thresholds.latencyMs,
      required: true,
    },
    {
      label: 'Double-tap hit rate',
      value: formatPercent(result.perGesture.double_tap?.hitRate ?? null),
      measured: (result.perGesture.double_tap?.trials ?? 0) > 0,
      pass: null,
      required: false,
    },
  ]
  const status = overallStatus(metrics)
  return {
    id: 'gestures',
    label: 'Gestures',
    status,
    detail: status === 'pass'
      ? `Measured on ${new Date(result.createdAt).toLocaleString()}: targets met.`
      : status === 'needs-tuning'
        ? 'Measured: at least one target is not met. Tune and re-run the suite.'
        : 'Measured only in part: run the full suite including the idle test.',
    metrics: strip(metrics),
  }
}

export interface VoiceBenchmarkResult {
  version: 1
  id: string
  createdAt: number
  wake: {
    engineInstalled: boolean
    seconds: number
    cpuPercent: number | null
    ramMb: number | null
    detail: string
  }
  ptt: { samples: number; avgLatencyMs: number | null }
  falseActivations: { seconds: number; count: number; perHour: number | null }
  accuracy: {
    english: { prompted: number; correct: number; accuracy: number | null }
    tanglish: { prompted: number; correct: number; accuracy: number | null }
  }
}

export function evaluateVoiceBenchmark(
  result: VoiceBenchmarkResult | null,
  thresholds: { pttLatencyMs: number; accuracy: number; falseActivationsPerHour: number },
  wakeEngineInstalled: boolean,
): ReliabilityStatus {
  if (!result) {
    return {
      id: 'voice',
      label: 'Voice',
      status: 'not-measured',
      detail: 'No voice benchmark has been run yet.',
      metrics: [
        { label: 'Push-to-talk latency', value: 'Not measured yet', measured: false, pass: null },
        { label: 'Recognition accuracy (English)', value: 'Not measured yet', measured: false, pass: null },
        { label: 'False activations', value: 'Not measured yet', measured: false, pass: null },
      ],
    }
  }
  const accuracy = result.accuracy.english.accuracy
  const ptt = result.ptt.avgLatencyMs
  const falseHour = result.falseActivations.perHour
  const metrics: MaybeMetric[] = [
    {
      label: 'Push-to-talk latency (key release → text)',
      value: ptt === null ? 'Not measured yet' : `${Math.round(ptt)} ms over ${result.ptt.samples} samples`,
      measured: ptt !== null,
      pass: ptt === null ? null : ptt <= thresholds.pttLatencyMs,
      required: true,
    },
    {
      label: 'Recognition accuracy (English)',
      value: accuracy === null
        ? 'Not measured yet'
        : `${formatPercent(accuracy)} (${result.accuracy.english.correct}/${result.accuracy.english.prompted} prompts)`,
      measured: accuracy !== null,
      pass: accuracy === null ? null : accuracy >= thresholds.accuracy,
      required: true,
    },
    {
      label: 'False activations in silence',
      value: falseHour === null
        ? 'Not measured yet'
        : `${falseHour.toFixed(2)}/hour (${result.falseActivations.count} in ${Math.round(result.falseActivations.seconds)} s)`,
      measured: falseHour !== null,
      pass: falseHour === null ? null : falseHour <= thresholds.falseActivationsPerHour,
      required: true,
    },
    {
      label: 'Wake-word CPU / RAM',
      value: !wakeEngineInstalled
        ? 'Not measured yet — no offline wake-word engine is installed'
        : result.wake.cpuPercent === null
          ? 'Not measured yet'
          : `${result.wake.cpuPercent}% main-thread load · ${result.wake.ramMb === null ? 'RAM not measured' : `${result.wake.ramMb} MB heap`}`,
      measured: wakeEngineInstalled && result.wake.cpuPercent !== null,
      pass: null,
      required: wakeEngineInstalled,
    },
    {
      label: 'Recognition accuracy (Tanglish)',
      value: `${formatPercent(result.accuracy.tanglish.accuracy)} (${result.accuracy.tanglish.correct}/${result.accuracy.tanglish.prompted} prompts)`,
      measured: result.accuracy.tanglish.prompted > 0,
      pass: null,
      required: false,
    },
  ]
  const status = overallStatus(metrics)
  return {
    id: 'voice',
    label: 'Voice',
    status,
    detail: status === 'pass'
      ? `Measured on ${new Date(result.createdAt).toLocaleString()}: targets met.`
      : status === 'needs-tuning'
        ? 'Measured: at least one target is not met.'
        : 'Measured only in part: run every prompted check.',
    metrics: strip(metrics),
  }
}

export interface ModelIntelligenceSummary {
  createdAt: number
  parts: number
  triangles: number | null
  genericParts: number
  confirmedLabels: number
  analysisMs: number
  warnings: number
}

export function evaluateModelIntelligence(
  summary: ModelIntelligenceSummary | null,
  thresholds: { analysisMs: number; maxTriangles: number },
): ReliabilityStatus {
  if (!summary) {
    return {
      id: 'models',
      label: '3D models',
      status: 'not-measured',
      detail: 'No model has been analysed yet.',
      metrics: [
        { label: 'Analysis time', value: 'Not measured yet', measured: false, pass: null },
        { label: 'Triangle count', value: 'Not measured yet', measured: false, pass: null },
        { label: 'Generic-named parts labelled', value: 'Not measured yet', measured: false, pass: null },
      ],
    }
  }
  const unlabelledGeneric = Math.max(0, summary.genericParts - summary.confirmedLabels)
  const metrics: MaybeMetric[] = [
    {
      label: 'Analysis time',
      value: `${Math.round(summary.analysisMs)} ms for ${summary.parts} parts`,
      measured: true,
      pass: summary.analysisMs <= thresholds.analysisMs,
      required: true,
    },
    {
      label: 'Triangle count',
      value: summary.triangles === null ? 'Not measured yet' : `${summary.triangles.toLocaleString()} triangles`,
      measured: summary.triangles !== null,
      pass: summary.triangles === null ? null : summary.triangles <= thresholds.maxTriangles,
      required: true,
    },
    {
      label: 'Generic-named parts left unlabelled',
      value: `${unlabelledGeneric} of ${summary.genericParts} generic names`,
      measured: true,
      pass: unlabelledGeneric === 0,
      required: true,
    },
  ]
  const status = overallStatus(metrics)
  return {
    id: 'models',
    label: '3D models',
    status,
    detail: status === 'pass'
      ? `Measured on ${new Date(summary.createdAt).toLocaleString()}: analysis fast and every generic name confirmed.`
      : status === 'needs-tuning'
        ? 'Analysis worked but some generic part names still need your confirmation.'
        : 'Measured only in part: load a model with triangle data.',
    metrics: strip(metrics),
  }
}

function readList<T>(key: string): T[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeList(key: string, list: unknown[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, 10)))
  } catch {
    // best effort
  }
}

export function saveGestureSuite(result: GestureSuiteResult): void {
  writeList(GESTURE_SUITE_KEY, [result, ...readList<GestureSuiteResult>(GESTURE_SUITE_KEY).filter((item) => item.id !== result.id)])
}

export function loadGestureSuites(): GestureSuiteResult[] {
  return readList<GestureSuiteResult>(GESTURE_SUITE_KEY).filter((item) => item && item.version === 1)
}

export function latestGestureSuite(): GestureSuiteResult | null {
  return loadGestureSuites()[0] ?? null
}

export function saveVoiceBenchmark(result: VoiceBenchmarkResult): void {
  writeList(VOICE_BENCH_KEY, [result, ...readList<VoiceBenchmarkResult>(VOICE_BENCH_KEY).filter((item) => item.id !== result.id)])
}

export function loadVoiceBenchmarks(): VoiceBenchmarkResult[] {
  return readList<VoiceBenchmarkResult>(VOICE_BENCH_KEY).filter((item) => item && item.version === 1)
}

export function latestVoiceBenchmark(): VoiceBenchmarkResult | null {
  return loadVoiceBenchmarks()[0] ?? null
}

export function resetBenchmarks(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(GESTURE_SUITE_KEY)
    localStorage.removeItem(VOICE_BENCH_KEY)
  } catch {
    // best effort
  }
}
