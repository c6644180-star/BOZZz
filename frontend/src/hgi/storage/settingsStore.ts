import { clamp } from '../geometry'
import { DEFAULT_HGI_SETTINGS, DEFAULT_BINDINGS } from '../types'
import type { CalibrationProfile, HgiBindings, HgiQuality, HgiSettings, GestureName } from '../types'

const SETTINGS_KEY = 'bozz.hgi.settings.v1'
const CALIBRATION_KEY = 'bozz.hgi.calibration.v1'

const QUALITIES: HgiQuality[] = ['low', 'medium', 'high']

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // local persistence is best-effort
  }
}

function asGestureName(value: unknown, fallback: GestureName): GestureName {
  return typeof value === 'string' && value.trim().length > 0 ? (value as GestureName) : fallback
}

function sanitizeBindings(value: unknown): HgiBindings {
  const input = (value ?? {}) as Partial<Record<keyof HgiBindings, unknown>>
  const output = { ...DEFAULT_BINDINGS }
  for (const key of Object.keys(DEFAULT_BINDINGS) as Array<keyof HgiBindings>) {
    output[key] = asGestureName(input[key], DEFAULT_BINDINGS[key])
  }
  return output
}

export function sanitizeSettings(value: unknown): HgiSettings {
  const input = (value ?? {}) as Partial<HgiSettings> & { desktop?: Partial<HgiSettings['desktop']> }
  const quality: HgiQuality = QUALITIES.includes(input.quality as HgiQuality)
    ? (input.quality as HgiQuality)
    : DEFAULT_HGI_SETTINGS.quality
  const pinchOn = clamp(Number(input.pinchOn) || DEFAULT_HGI_SETTINGS.pinchOn, 0.08, 0.5)
  const pinchOff = clamp(Number(input.pinchOff) || DEFAULT_HGI_SETTINGS.pinchOff, pinchOn + 0.05, 0.9)
  return {
    quality,
    minCutoff: clamp(Number(input.minCutoff) || DEFAULT_HGI_SETTINGS.minCutoff, 0.2, 8),
    beta: clamp(Number(input.beta) || DEFAULT_HGI_SETTINGS.beta, 0, 2),
    minConfidence: clamp(Number(input.minConfidence) || DEFAULT_HGI_SETTINGS.minConfidence, 0.3, 0.95),
    pinchOn,
    pinchOff,
    micConfirmClap: input.micConfirmClap !== false,
    desktop: {
      sensitivity: clamp(Number(input.desktop?.sensitivity) || DEFAULT_HGI_SETTINGS.desktop.sensitivity, 0.3, 2.5),
      smoothing: clamp(Number(input.desktop?.smoothing) || DEFAULT_HGI_SETTINGS.desktop.smoothing, 0, 0.9),
      area: clamp(Number(input.desktop?.area) || DEFAULT_HGI_SETTINGS.desktop.area, 0.3, 1),
      positionX: clamp(Number(input.desktop?.positionX) || 0, -0.5, 0.5),
      positionY: clamp(Number(input.desktop?.positionY) || 0, -0.5, 0.5),
      edgeMargin: clamp(Number(input.desktop?.edgeMargin) || 0, 0, 100),
      clickDelayMs: clamp(Number(input.desktop?.clickDelayMs) || 0, 0, 500),
      idleSeconds: clamp(Number(input.desktop?.idleSeconds) || DEFAULT_HGI_SETTINGS.desktop.idleSeconds, 10, 3600),
    },
    bindings: sanitizeBindings(input.bindings),
  }
}

export function loadHgiSettings(): HgiSettings {
  return sanitizeSettings(readJson<Partial<HgiSettings>>(SETTINGS_KEY) ?? DEFAULT_HGI_SETTINGS)
}

export function saveHgiSettings(settings: HgiSettings): void {
  writeJson(SETTINGS_KEY, settings)
}

export function loadCalibration(): CalibrationProfile | null {
  const value = readJson<CalibrationProfile>(CALIBRATION_KEY)
  if (!value || value.version !== 1) return null
  if (!value.centroids || !value.sampleCounts) return null
  return value
}

export function saveCalibration(profile: CalibrationProfile): void {
  writeJson(CALIBRATION_KEY, profile)
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(CALIBRATION_KEY)
  } catch {
    // ignore
  }
}
