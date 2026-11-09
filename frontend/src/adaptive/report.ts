import { diagnostics } from './diagnostics'
import {
  evaluateGestureSuite,
  evaluateModelIntelligence,
  evaluateVoiceBenchmark,
  latestGestureSuite,
  latestVoiceBenchmark,
  resetBenchmarks,
  type ModelIntelligenceSummary,
  type VoiceBenchmarkResult,
  type GestureSuiteResult,
} from './benchmarks'
import { loadAdaptiveSettings } from './settings'
import { wakeWordStatus } from './wakeWord'
import type { AdaptiveSettings, DiagnosticsSnapshot, ReliabilityStatus } from './types'

const MODEL_SUMMARY_KEY = 'bozz.adaptive.modelSummary.v1'

export interface ReliabilityReport {
  version: 1
  generatedAt: number
  settings: AdaptiveSettings
  subsystems: ReliabilityStatus[]
  diagnostics: DiagnosticsSnapshot
  benchmarks: {
    gestureSuite: GestureSuiteResult | null
    voice: VoiceBenchmarkResult | null
  }
  modelSummary: ModelIntelligenceSummary | null
}

export function saveModelSummary(summary: ModelIntelligenceSummary): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MODEL_SUMMARY_KEY, JSON.stringify(summary))
  } catch {
    // best effort
  }
}

export function loadModelSummary(): ModelIntelligenceSummary | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(MODEL_SUMMARY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ModelIntelligenceSummary>
    if (
      typeof parsed.parts !== 'number' ||
      typeof parsed.analysisMs !== 'number' ||
      typeof parsed.genericParts !== 'number' ||
      typeof parsed.confirmedLabels !== 'number'
    ) {
      return null
    }
    return {
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      parts: parsed.parts,
      triangles: typeof parsed.triangles === 'number' ? parsed.triangles : null,
      genericParts: parsed.genericParts,
      confirmedLabels: parsed.confirmedLabels,
      analysisMs: parsed.analysisMs,
      warnings: typeof parsed.warnings === 'number' ? parsed.warnings : 0,
    }
  } catch {
    return null
  }
}

export function buildReliabilityReport(): ReliabilityReport {
  const settings = loadAdaptiveSettings()
  const gestureSuite = latestGestureSuite()
  const voiceBenchmark = latestVoiceBenchmark()
  const modelSummary = loadModelSummary()
  return {
    version: 1,
    generatedAt: Date.now(),
    settings,
    subsystems: [
      evaluateGestureSuite(gestureSuite, settings.gestures.suite),
      evaluateVoiceBenchmark(voiceBenchmark, settings.voice, wakeWordStatus().installed),
      evaluateModelIntelligence(modelSummary, settings.models),
    ],
    diagnostics: diagnostics.snapshot(),
    benchmarks: { gestureSuite, voice: voiceBenchmark },
    modelSummary,
  }
}

export function resetReliabilityData(): void {
  diagnostics.resetAll()
  resetBenchmarks()
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(MODEL_SUMMARY_KEY)
    } catch {
      // best effort
    }
  }
}

export function downloadJson(filename: string, content: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function reliabilityFileName(prefix = 'bozz-reliability'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}-${stamp}.json`
}
