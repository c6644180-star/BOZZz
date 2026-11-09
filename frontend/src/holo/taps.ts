export interface TapConfig {
  maxTapMs: number
  doubleWindowMs: number
  cooldownMs: number
}

export const DEFAULT_TAP_CONFIG: TapConfig = {
  maxTapMs: 350,
  doubleWindowMs: 600,
  cooldownMs: 250,
}

export type TapKind = 'single' | 'double'

export interface TapResult {
  kind: TapKind
  key: string
}

/**
 * Pointer and gesture taps share this timing rule. A press longer than
 * ``maxTapMs`` is a hold, not a tap. Two taps on the same node within
 * ``doubleWindowMs`` become a double tap; the first tap is only emitted once
 * the double window closes, so a double tap never expands a folder first.
 */
export class TapRecognizer {
  readonly config: TapConfig
  private last: { key: string; at: number } | null = null
  private lastAcceptedAt = -Infinity

  constructor(config: Partial<TapConfig> = {}) {
    this.config = { ...DEFAULT_TAP_CONFIG, ...config }
  }

  end(key: string, durationMs: number, at: number): TapResult | null {
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > this.config.maxTapMs) {
      return null
    }
    if (at - this.lastAcceptedAt < this.config.cooldownMs) return null

    const last = this.last
    if (last && last.key === key && at - last.at <= this.config.doubleWindowMs) {
      this.last = null
      this.lastAcceptedAt = at
      return { kind: 'double', key }
    }

    let result: TapResult | null = null
    if (last) {
      result = { kind: 'single', key: last.key }
    }
    this.last = { key, at }
    this.lastAcceptedAt = at
    return result
  }

  /** Returns the delayed single tap once its double-tap window has closed. */
  pendingSingle(at: number): string | null {
    if (!this.last) return null
    if (at - this.last.at <= this.config.doubleWindowMs) return null
    const key = this.last.key
    this.last = null
    return key
  }

  reset(): void {
    this.last = null
    this.lastAcceptedAt = -Infinity
  }
}
