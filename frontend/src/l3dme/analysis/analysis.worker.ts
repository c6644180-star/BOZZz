import { analyzeModel } from './intelligence'

interface WorkerRequest {
  hash: string
  fileName: string
  parts: Parameters<typeof analyzeModel>[0]['parts']
  bounds: Parameters<typeof analyzeModel>[0]['bounds']
  center: Parameters<typeof analyzeModel>[0]['center']
  warnings: string[]
  startedAt: number
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const input = event.data
  try {
    self.postMessage({ kind: 'progress', progress: 0.2, detail: 'Reading hierarchy and names…' })
    const analysis = analyzeModel({
      hash: input.hash,
      fileName: input.fileName,
      parts: input.parts,
      bounds: input.bounds,
      center: input.center,
      warnings: input.warnings,
      analysisMs: performance.now() - input.startedAt,
    })
    self.postMessage({ kind: 'progress', progress: 0.85, detail: 'Comparing sizes, mirrors and repeats…' })
    self.postMessage({ kind: 'done', analysis })
  } catch (error) {
    self.postMessage({
      kind: 'error',
      detail: error instanceof Error ? error.message : 'Unknown analysis error.',
    })
  }
}
