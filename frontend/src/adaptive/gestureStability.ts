import { combineConfidence, makeConfidence } from './confidence'
import type { Confidence } from './types'

export interface StabilityConfig {
  requiredFrames: number
  maxJump: number
  edgeMargin: number
  minScore: number
}

export interface StabilitySample {
  x: number
  y: number
  score: number
  timestamp: number
}

export interface StabilityResult {
  stable: boolean
  confidence: Confidence
  consecutive: number
  jump: number
  edge: boolean
  reasons: string[]
}

export const DEFAULT_STABILITY_CONFIG: StabilityConfig = {
  requiredFrames: 3,
  maxJump: 0.22,
  edgeMargin: 0.03,
  minScore: 0.5,
}

// Rejects landmark teleports, hands entering or leaving the frame, low tracking
// confidence and single-frame poses. A gesture only becomes stable after N
// consecutive accepted frames.
export class GestureStabilizer {
  config: StabilityConfig
  private previous: { x: number; y: number } | null = null
  private consecutive = 0

  constructor(config: Partial<StabilityConfig> = {}) {
    this.config = { ...DEFAULT_STABILITY_CONFIG, ...config }
  }

  get stableFrames(): number {
    return this.consecutive
  }

  reset(): void {
    this.previous = null
    this.consecutive = 0
  }

  update(sample: StabilitySample): StabilityResult {
    const reasons: string[] = []
    const edge =
      sample.x < this.config.edgeMargin ||
      sample.y < this.config.edgeMargin ||
      sample.x > 1 - this.config.edgeMargin ||
      sample.y > 1 - this.config.edgeMargin

    const dx = this.previous ? sample.x - this.previous.x : 0
    const dy = this.previous ? sample.y - this.previous.y : 0
    const jump = Math.hypot(dx, dy)

    if (sample.score < this.config.minScore) {
      this.consecutive = 0
      reasons.push(`Tracking confidence ${(sample.score * 100).toFixed(0)}% is below ${(this.config.minScore * 100).toFixed(0)}%.`)
    } else if (edge) {
      this.consecutive = 0
      reasons.push('Hand is at the frame edge; edges are ignored so entering or leaving cannot fire a gesture.')
    } else if (this.previous && jump > this.config.maxJump) {
      this.consecutive = 0
      reasons.push(`Landmark jump ${jump.toFixed(3)} exceeds the ${this.config.maxJump.toFixed(2)} limit (teleport rejected).`)
    } else {
      this.consecutive += 1
    }

    this.previous = { x: sample.x, y: sample.y }
    const ratio = Math.min(1, this.consecutive / Math.max(1, this.config.requiredFrames))
    const jumpQuality = this.previous ? 1 - Math.min(1, jump / Math.max(0.001, this.config.maxJump)) : 1
    const confidence = combineConfidence(
      [
        { value: sample.score, weight: 2, reason: `Landmark confidence ${(sample.score * 100).toFixed(0)}%.` },
        {
          value: ratio,
          weight: 1.4,
          reason: ratio >= 1
            ? `${this.consecutive} consecutive stable frames.`
            : `${this.consecutive} of ${this.config.requiredFrames} required stable frames.`,
        },
        { value: this.config.requiredFrames === 1 ? 1 : jumpQuality, weight: 0.6, reason: `Frame-to-frame movement ${jump.toFixed(3)}.` },
      ],
      'landmark',
    )
    const stable = this.consecutive >= this.config.requiredFrames && !edge
    if (!stable && reasons.length === 0) reasons.push('Waiting for enough consecutive stable frames.')
    return {
      stable,
      confidence: stable ? confidence : makeConfidence(0, 'landmark', reasons),
      consecutive: this.consecutive,
      jump,
      edge,
      reasons,
    }
  }
}
