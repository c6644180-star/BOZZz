import { clamp } from '../geometry'
import { BUILTIN_CENTROIDS } from './builtinGestures'
import type { CalibrationProfile, Classification, GestureName, HandFeatures, TaughtGesture } from '../types'

const WEIGHTS = [1, 1, 1, 1, 1, 1.4, 1, 0.8, 0.8, 0.8, 0.5, 0.5]

export interface ClassifierContext {
  hands: number
  twoHandDistance: number | null
  twoHandClosing: number
  micSpike: boolean
  otherHand: HandFeatures | null
  minConfidence: number
}

interface Scored {
  name: GestureName
  distance: number
}

function weightedDistance(a: number[], b: number[]): number {
  let sum = 0
  const length = Math.min(WEIGHTS.length, a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] - b[index]) * WEIGHTS[index]
    sum += delta * delta
  }
  return Math.sqrt(sum)
}

function confidenceFrom(best: number, second: number): number {
  const base = 1 / (1 + best * best)
  const margin = second > 1e-4 ? clamp((second - best) / second, 0, 1) : 1
  return clamp(base * 0.75 + margin * 0.25, 0, 0.99)
}

// Nearest-centroid classifier for the built-in gestures, a small k-NN layer for
// gestures the user teaches, and dynamic rules for motion gestures. It only
// returns numbers; deciding whether a gesture is trustworthy happens in the
// engine and the pinch state machine.
export class GestureClassifier {
  private calibration: CalibrationProfile | null = null
  private custom: TaughtGesture[] = []

  setCalibration(profile: CalibrationProfile | null): void {
    this.calibration = profile
  }

  setCustomGestures(gestures: TaughtGesture[]): void {
    this.custom = gestures.filter((gesture) => gesture.samples.length >= 5)
  }

  get customCount(): number {
    return this.custom.length
  }

  classify(features: HandFeatures, context: ClassifierContext): Classification {
    const dynamic = this.classifyDynamic(features, context)
    if (dynamic) {
      return { hand: features.hand, name: dynamic.name, confidence: dynamic.confidence, timestamp: 0 }
    }

    const scored: Scored[] = []
    for (const [name, centroid] of Object.entries(BUILTIN_CENTROIDS)) {
      const gestureName = name as GestureName
      const reference =
        this.calibration &&
        (gestureName === 'open_palm' || gestureName === 'pinch' || gestureName === 'fist') &&
        this.calibration.centroids[gestureName].length === features.vector.length
          ? this.calibration.centroids[gestureName]
          : centroid
      scored.push({ name: gestureName, distance: weightedDistance(features.vector, reference) })
    }

    for (const gesture of this.custom) {
      const nearest = gesture.samples
        .map((sample) => weightedDistance(features.vector, sample))
        .sort((a, b) => a - b)
        .slice(0, Math.min(3, gesture.samples.length))
      if (nearest.length > 0) {
        const average = nearest.reduce((sum, value) => sum + value, 0) / nearest.length
        scored.push({ name: `custom:${gesture.name}` as GestureName, distance: average })
      }
    }

    scored.sort((a, b) => a.distance - b.distance)
    const best = scored[0]
    const second = scored[1] ?? { distance: best.distance + 1 }
    return {
      hand: features.hand,
      name: best.name,
      confidence: confidenceFrom(best.distance, second.distance),
      timestamp: 0,
    }
  }

  private classifyDynamic(
    features: HandFeatures,
    context: ClassifierContext,
  ): { name: GestureName; confidence: number } | null {
    if (context.hands >= 2 && context.otherHand) {
      const bothPinched = features.pinchRatio <= 0.42 && context.otherHand.pinchRatio <= 0.42
      if (bothPinched) {
        const worst = Math.max(features.pinchRatio, context.otherHand.pinchRatio)
        const confidence = clamp(0.72 + (0.42 - worst) * 0.6, 0, 0.97)
        return { name: 'two_hand_pinch', confidence }
      }

      const palmsOpen = features.openness > 0.55 && context.otherHand.openness > 0.55
      const closing = context.twoHandClosing > 0.55
      const touching = context.twoHandDistance !== null && context.twoHandDistance < 0.9
      if (palmsOpen && (closing || touching)) {
        const raw = closing ? 0.55 + Math.min(0.2, context.twoHandClosing * 0.05) : 0.34
        const confidence = context.micSpike ? Math.max(0.82, raw) : raw
        if (confidence >= context.minConfidence) return { name: 'clap', confidence }
      }
    }

    if (features.speed > 1.1 && features.extension[1] > 0.5 && features.openness > 0.22) {
      const confidence = clamp(0.58 + (features.speed - 1.1) * 0.18, 0, 0.95)
      if (confidence >= context.minConfidence) return { name: 'flick', confidence }
    }

    if (Math.abs(features.rollRate) > 2.2 && features.openness > 0.35 && features.pinchRatio > 0.45) {
      const confidence = clamp(0.58 + (Math.abs(features.rollRate) - 2.2) * 0.1, 0, 0.92)
      if (confidence >= context.minConfidence) return { name: 'wrist_rotation', confidence }
    }

    return null
  }
}
