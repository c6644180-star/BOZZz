import type { AdaptiveSettings, GestureTransitionSettings, HandGestureSettings } from './types'

const STORAGE_KEY = 'bozz.adaptive.settings.v1'
export const ADAPTIVE_SETTINGS_EVENT = 'bozz:adaptive-settings'

export const DEFAULT_ADAPTIVE_SETTINGS: AdaptiveSettings = {
  version: 1,
  thresholds: { safe: 0.62, consequential: 0.85 },
  gestures: {
    enterMs: 70,
    holdMs: 120,
    tapMaxMs: 260,
    doubleTapWindowMs: 320,
    cooldownMs: 260,
    lostMs: 200,
    stableFrames: 3,
    maxJump: 0.22,
    edgeMargin: 0.03,
    left: { enabled: true, thresholdScale: 1, enterMs: 70 },
    right: { enabled: true, thresholdScale: 1, enterMs: 70 },
    suite: { pinchHitRate: 0.9, falseTriggersPerMinute: 2, latencyMs: 150 },
    tunedFrom: { calibrationAt: null, proposalAcceptedAt: null },
  },
  voice: {
    pttLatencyMs: 1500,
    accuracy: 0.85,
    falseActivationsPerHour: 1,
    cpuSuspendPercent: 85,
    cpuSuspendSeconds: 10,
    confirmLowConfidence: true,
    logCommandText: false,
  },
  models: {
    analysisMs: 2000,
    largeFileBytes: 50 * 1024 * 1024,
    maxTriangles: 200_000,
    autoAnalyze: true,
    confirmBeforeAskAI: true,
  },
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sanitizeHand(value: unknown, fallback: HandGestureSettings): HandGestureSettings {
  const raw = (value ?? {}) as Partial<HandGestureSettings>
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    thresholdScale: clamp(raw.thresholdScale, 0.6, 1.6, fallback.thresholdScale),
    enterMs: clamp(raw.enterMs, 0, 400, fallback.enterMs),
  }
}

export function sanitizeAdaptiveSettings(input: unknown): AdaptiveSettings {
  const raw = (input ?? {}) as Partial<AdaptiveSettings>
  const fallback = DEFAULT_ADAPTIVE_SETTINGS
  const thresholds = (raw.thresholds ?? {}) as Partial<AdaptiveSettings['thresholds']>
  const gestures = (raw.gestures ?? {}) as Partial<AdaptiveSettings['gestures']>
  const suite = (gestures.suite ?? {}) as Partial<AdaptiveSettings['gestures']['suite']>
  const tuned = (gestures.tunedFrom ?? {}) as Partial<AdaptiveSettings['gestures']['tunedFrom']>
  const voice = (raw.voice ?? {}) as Partial<AdaptiveSettings['voice']>
  const models = (raw.models ?? {}) as Partial<AdaptiveSettings['models']>

  const safe = clamp(thresholds.safe, 0.2, 0.95, fallback.thresholds.safe)
  return {
    version: 1,
    thresholds: {
      safe,
      consequential: clamp(thresholds.consequential, Math.max(safe + 0.05, 0.4), 0.99, fallback.thresholds.consequential),
    },
    gestures: {
      enterMs: clamp(gestures.enterMs, 0, 400, fallback.gestures.enterMs),
      holdMs: clamp(gestures.holdMs, 40, 600, fallback.gestures.holdMs),
      tapMaxMs: clamp(gestures.tapMaxMs, 80, 600, fallback.gestures.tapMaxMs),
      doubleTapWindowMs: clamp(gestures.doubleTapWindowMs, 150, 800, fallback.gestures.doubleTapWindowMs),
      cooldownMs: clamp(gestures.cooldownMs, 0, 800, fallback.gestures.cooldownMs),
      lostMs: clamp(gestures.lostMs, 50, 800, fallback.gestures.lostMs),
      stableFrames: Math.round(clamp(gestures.stableFrames, 1, 10, fallback.gestures.stableFrames)),
      maxJump: clamp(gestures.maxJump, 0.05, 0.6, fallback.gestures.maxJump),
      edgeMargin: clamp(gestures.edgeMargin, 0, 0.2, fallback.gestures.edgeMargin),
      left: sanitizeHand(gestures.left, fallback.gestures.left),
      right: sanitizeHand(gestures.right, fallback.gestures.right),
      suite: {
        pinchHitRate: clamp(suite.pinchHitRate, 0.5, 1, fallback.gestures.suite.pinchHitRate),
        falseTriggersPerMinute: clamp(suite.falseTriggersPerMinute, 0, 20, fallback.gestures.suite.falseTriggersPerMinute),
        latencyMs: clamp(suite.latencyMs, 20, 1000, fallback.gestures.suite.latencyMs),
      },
      tunedFrom: {
        calibrationAt: numberOrNull(tuned.calibrationAt),
        proposalAcceptedAt: numberOrNull(tuned.proposalAcceptedAt),
      },
    },
    voice: {
      pttLatencyMs: clamp(voice.pttLatencyMs, 200, 5000, fallback.voice.pttLatencyMs),
      accuracy: clamp(voice.accuracy, 0.5, 1, fallback.voice.accuracy),
      falseActivationsPerHour: clamp(voice.falseActivationsPerHour, 0, 60, fallback.voice.falseActivationsPerHour),
      cpuSuspendPercent: clamp(voice.cpuSuspendPercent, 30, 100, fallback.voice.cpuSuspendPercent),
      cpuSuspendSeconds: clamp(voice.cpuSuspendSeconds, 3, 60, fallback.voice.cpuSuspendSeconds),
      confirmLowConfidence: bool(voice.confirmLowConfidence, fallback.voice.confirmLowConfidence),
      logCommandText: bool(voice.logCommandText, fallback.voice.logCommandText),
    },
    models: {
      analysisMs: clamp(models.analysisMs, 100, 30000, fallback.models.analysisMs),
      largeFileBytes: clamp(models.largeFileBytes, 1_000_000, 500_000_000, fallback.models.largeFileBytes),
      maxTriangles: Math.round(clamp(models.maxTriangles, 1000, 5_000_000, fallback.models.maxTriangles)),
      autoAnalyze: bool(models.autoAnalyze, fallback.models.autoAnalyze),
      confirmBeforeAskAI: bool(models.confirmBeforeAskAI, fallback.models.confirmBeforeAskAI),
    },
  }
}

export function loadAdaptiveSettings(): AdaptiveSettings {
  if (typeof localStorage === 'undefined') return sanitizeAdaptiveSettings(null)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return sanitizeAdaptiveSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitizeAdaptiveSettings(null)
  }
}

export function saveAdaptiveSettings(settings: AdaptiveSettings): AdaptiveSettings {
  const clean = sanitizeAdaptiveSettings(settings)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // storage blocked; in-memory callers still get the clean value
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ADAPTIVE_SETTINGS_EVENT, { detail: clean }))
  }
  return clean
}

export function updateAdaptiveSettings(patch: Partial<AdaptiveSettings>): AdaptiveSettings {
  const current = loadAdaptiveSettings()
  return saveAdaptiveSettings({
    ...current,
    ...patch,
    thresholds: { ...current.thresholds, ...patch.thresholds },
    gestures: {
      ...current.gestures,
      ...patch.gestures,
      left: { ...current.gestures.left, ...patch.gestures?.left },
      right: { ...current.gestures.right, ...patch.gestures?.right },
      suite: { ...current.gestures.suite, ...patch.gestures?.suite },
      tunedFrom: { ...current.gestures.tunedFrom, ...patch.gestures?.tunedFrom },
    },
    voice: { ...current.voice, ...patch.voice },
    models: { ...current.models, ...patch.models },
  })
}

export function resetAdaptiveSettings(): AdaptiveSettings {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // best effort
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ADAPTIVE_SETTINGS_EVENT, { detail: DEFAULT_ADAPTIVE_SETTINGS }))
  }
  return sanitizeAdaptiveSettings(null)
}

export function handSettingsFor(key: string, gestures: GestureTransitionSettings): HandGestureSettings | null {
  if (/^left/i.test(key)) return gestures.left
  if (/^right/i.test(key)) return gestures.right
  return null
}
