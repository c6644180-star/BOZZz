import { clamp } from '../geometry'
import { CALIBRATION_PHASES } from '../types'
import type { CalibrationPhase, CalibrationProfile, HandFeatures } from '../types'

export interface CalibrationUpdate {
  phase: CalibrationPhase
  phaseIndex: number
  phaseProgress: number
  totalProgress: number
  samples: number
  waiting: boolean
  done: boolean
  profile?: CalibrationProfile
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1)
  return sorted[index]
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const length = vectors[0].length
  const output = new Array<number>(length).fill(0)
  for (const vector of vectors) {
    for (let index = 0; index < length; index += 1) output[index] += vector[index]
  }
  for (let index = 0; index < length; index += 1) output[index] /= vectors.length
  return output
}

// Four phases of about 2.5 seconds each. Time only advances while a hand is
// visible, so a lost hand pauses calibration instead of collecting noise.
export class Calibrator {
  phaseDurationMs = 2500
  running = false

  private phaseIndex = 0
  private elapsed = 0
  private lastTimestamp = 0
  private samples: Record<CalibrationPhase, number[][]> = {
    open_palm: [],
    pinch: [],
    fist: [],
    relaxed: [],
  }

  start(timestamp: number): CalibrationUpdate {
    this.running = true
    this.phaseIndex = 0
    this.elapsed = 0
    this.lastTimestamp = timestamp
    this.samples = { open_palm: [], pinch: [], fist: [], relaxed: [] }
    return this.snapshot(false)
  }

  tick(hands: HandFeatures[], timestamp: number): CalibrationUpdate | null {
    if (!this.running) return null
    const dt = clamp(timestamp - this.lastTimestamp, 0, 200)
    this.lastTimestamp = timestamp
    const hand = hands.find((item) => item.score > 0.5)
    const waiting = !hand

    if (hand) {
      this.elapsed += dt
      this.samples[CALIBRATION_PHASES[this.phaseIndex]].push([...hand.vector])
    }

    if (this.elapsed >= this.phaseDurationMs) {
      this.elapsed = 0
      this.phaseIndex += 1
      if (this.phaseIndex >= CALIBRATION_PHASES.length) {
        this.running = false
        this.phaseIndex = CALIBRATION_PHASES.length - 1
        return this.snapshot(true)
      }
    }

    return this.snapshot(false, waiting)
  }

  cancel(): void {
    this.running = false
  }

  private snapshot(done: boolean, waiting = false): CalibrationUpdate {
    const phase = CALIBRATION_PHASES[this.phaseIndex]
    return {
      phase,
      phaseIndex: this.phaseIndex,
      phaseProgress: clamp(this.elapsed / this.phaseDurationMs, 0, 1),
      totalProgress: clamp(
        (this.phaseIndex + this.elapsed / this.phaseDurationMs) / CALIBRATION_PHASES.length,
        0,
        1,
      ),
      samples: this.samples[phase].length,
      waiting,
      done,
      profile: done ? this.buildProfile() : undefined,
    }
  }

  private buildProfile(): CalibrationProfile {
    const pinchRatios = this.samples.pinch.map((vector) => vector[5] * 1.5)
    const openRatios = this.samples.open_palm.map((vector) => vector[5] * 1.5)
    const pinchOn = clamp(percentile(pinchRatios, 0.75), 0.12, 0.5)
    const openLow = openRatios.length > 0 ? percentile(openRatios, 0.25) : pinchOn + 0.3
    const pinchOff = clamp(Math.max(pinchOn + 0.08, Math.min(openLow, pinchOn + 0.25)), pinchOn + 0.08, 0.75)

    const centroids = {
      open_palm: averageVectors(this.samples.open_palm),
      pinch: averageVectors(this.samples.pinch),
      fist: averageVectors(this.samples.fist),
      relaxed: averageVectors(this.samples.relaxed),
    }
    return {
      version: 1,
      createdAt: Date.now(),
      pinchOn: Number(pinchOn.toFixed(3)),
      pinchOff: Number(pinchOff.toFixed(3)),
      centroids,
      sampleCounts: {
        open_palm: this.samples.open_palm.length,
        pinch: this.samples.pinch.length,
        fist: this.samples.fist.length,
        relaxed: this.samples.relaxed.length,
      },
    }
  }
}
