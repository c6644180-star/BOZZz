// Shared reliability primitives. Every confidence value shown by BOZZ comes
// from one of these sources; nothing is invented.

export type SubsystemId = 'gestures' | 'voice' | 'models'

export type ConfidenceSource =
  | 'landmark'
  | 'classifier'
  | 'speech'
  | 'keyboard'
  | 'geometry'
  | 'hierarchy'
  | 'pattern'
  | 'measurement'

export interface Confidence {
  value: number
  source: ConfidenceSource
  reasons: string[]
}

export type ActionClass = 'safe' | 'consequential' | 'blocked'

export type Decision = 'execute' | 'confirm' | 'reject' | 'block'

export interface ActionDecision {
  actionClass: ActionClass
  decision: Decision
  threshold: number
  fallback: string
  reason: string
}

export interface ReliabilityStatus {
  id: SubsystemId
  label: string
  status: 'pass' | 'needs-tuning' | 'not-measured'
  detail: string
  metrics: StatusMetric[]
}

export interface StatusMetric {
  label: string
  value: string
  measured: boolean
  pass: boolean | null
}

export interface HandGestureSettings {
  enabled: boolean
  thresholdScale: number
  enterMs: number
}

export interface GestureTransitionSettings {
  enterMs: number
  holdMs: number
  tapMaxMs: number
  doubleTapWindowMs: number
  cooldownMs: number
  lostMs: number
  stableFrames: number
  maxJump: number
  edgeMargin: number
  left: HandGestureSettings
  right: HandGestureSettings
}

export interface GestureSuiteThresholds {
  pinchHitRate: number
  falseTriggersPerMinute: number
  latencyMs: number
}

export interface VoiceReliabilityThresholds {
  pttLatencyMs: number
  accuracy: number
  falseActivationsPerHour: number
  cpuSuspendPercent: number
  cpuSuspendSeconds: number
}

export interface ModelReliabilityThresholds {
  analysisMs: number
  largeFileBytes: number
  maxTriangles: number
}

export interface AdaptiveSettings {
  version: 1
  thresholds: {
    safe: number
    consequential: number
  }
  gestures: GestureTransitionSettings & {
    suite: GestureSuiteThresholds
    tunedFrom: { calibrationAt: number | null; proposalAcceptedAt: number | null }
  }
  voice: VoiceReliabilityThresholds & {
    confirmLowConfidence: boolean
    logCommandText: boolean
  }
  models: ModelReliabilityThresholds & {
    autoAnalyze: boolean
    confirmBeforeAskAI: boolean
  }
}

export interface CpuSample {
  at: number
  load: number
  ramMb: number | null
  source: 'main-thread'
}

export interface SubsystemCounters {
  latencySamples: number[]
  cpuSamples: CpuSample[]
  uncertainEvents: number
  rejectedEvents: number
  falseActivations: number
  corrections: number
  sessions: number
  lastEventAt: number | null
}

export interface ModelAnalysisCounters {
  analysisMs: number[]
  lastParts: number | null
  lastTriangles: number | null
  warnings: number
  lastEventAt: number | null
}

export interface DiagnosticsSnapshot {
  version: 1
  gestures: SubsystemCounters & { pinchStarts: number; shortPinches: number }
  voice: SubsystemCounters & { pttLatencies: number[]; confidenceSamples: number[] }
  models: ModelAnalysisCounters
  commandLog: Array<{ at: number; text: string; corrected: boolean }>
}

export interface LoggedCommand {
  at: number
  text: string
  corrected: boolean
}
