import { analyzeModel, type BoundsInput, type ModelAnalysis, type ModelPartInput } from './intelligence'

export interface ModelAnalysisInput {
  hash: string
  fileName: string
  parts: ModelPartInput[]
  bounds: BoundsInput
  center: [number, number, number]
  warnings: string[]
}

export interface AnalysisProgress {
  progress: number
  detail: string
}

const CACHE_KEY = 'bozz.l3dme.cache.v1'
const CACHE_LIMIT = 5
const CACHE_MAX_CHARS = 400_000

interface CacheEntry {
  hash: string
  fileName: string
  savedAt: number
  analysis: ModelAnalysis
}

function readCache(): CacheEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as CacheEntry[]) : []
  } catch {
    return []
  }
}

export function loadCachedAnalysis(hash: string): ModelAnalysis | null {
  const entry = readCache().find((item) => item.hash === hash)
  return entry?.analysis ?? null
}

function saveCache(analysis: ModelAnalysis): void {
  if (typeof localStorage === 'undefined') return
  const entries = readCache().filter((entry) => entry.hash !== analysis.hash)
  const next: CacheEntry[] = [
    { hash: analysis.hash, fileName: analysis.fileName, savedAt: Date.now(), analysis },
    ...entries,
  ].slice(0, CACHE_LIMIT)
  try {
    const encoded = JSON.stringify(next)
    if (encoded.length <= CACHE_MAX_CHARS) localStorage.setItem(CACHE_KEY, encoded)
  } catch {
    // Cache is optional; the analysis still returns to the caller.
  }
}

export function clearAnalysisCache(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // best effort
  }
}

function runInWorker(
  input: ModelAnalysisInput,
  startedAt: number,
  onProgress: (update: AnalysisProgress) => void,
): Promise<ModelAnalysis> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      reject(new Error('Worker construction failed.'))
      return
    }
    const finish = (action: () => void) => {
      worker.terminate()
      action()
    }
    worker.onmessage = (event: MessageEvent<{ kind: string; progress?: number; detail?: string; analysis?: ModelAnalysis }>) => {
      const message = event.data
      if (message.kind === 'progress') {
        onProgress({ progress: message.progress ?? 0, detail: message.detail ?? '' })
        return
      }
      if (message.kind === 'done' && message.analysis) {
        finish(() => resolve(message.analysis as ModelAnalysis))
        return
      }
      if (message.kind === 'error') {
        finish(() => reject(new Error(message.detail || 'Worker analysis failed.')))
      }
    }
    worker.onerror = () => {
      finish(() => reject(new Error('Worker analysis crashed.')))
    }
    worker.postMessage({
      hash: input.hash,
      fileName: input.fileName,
      parts: input.parts,
      bounds: input.bounds,
      center: input.center,
      warnings: input.warnings,
      startedAt,
    })
  })
}

/**
 * Runs the analysis locally. The worker keeps the main thread free; if it is
 * blocked by the browser, the same pure function runs synchronously so the
 * numbers stay real either way.
 */
export async function runModelAnalysis(
  input: ModelAnalysisInput,
  onProgress: (update: AnalysisProgress) => void = () => {},
): Promise<ModelAnalysis> {
  const startedAt = performance.now()
  onProgress({ progress: 0.05, detail: 'Collecting parts from the loaded scene…' })
  try {
    const analysis = await runInWorker(input, startedAt, onProgress)
    saveCache(analysis)
    onProgress({ progress: 1, detail: 'Analysis complete.' })
    return analysis
  } catch {
    onProgress({ progress: 0.4, detail: 'The worker was unavailable, so the same analysis ran on the main thread.' })
    const analysis = analyzeModel({
      hash: input.hash,
      fileName: input.fileName,
      parts: input.parts,
      bounds: input.bounds,
      center: input.center,
      warnings: input.warnings,
      analysisMs: performance.now() - startedAt,
    })
    saveCache(analysis)
    onProgress({ progress: 1, detail: 'Analysis complete (main thread).' })
    return analysis
  }
}
