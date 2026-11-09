export interface TapInput {
  target: string
  timestamp: number
  confidence: number
}

export interface TapResult {
  kind: 'single' | 'double'
  target: string
  at: number
  intervalMs: number | null
  confidence: number
}

export const DEFAULT_DOUBLE_TAP_WINDOW_MS = 320

// Two taps on the same target within the window are a double tap. A different
// target always starts a new sequence.
export class TapTracker {
  private last: TapInput | null = null
  private windowMs: number

  constructor(windowMs = DEFAULT_DOUBLE_TAP_WINDOW_MS) {
    this.windowMs = Math.max(150, Math.min(800, windowMs))
  }

  setWindow(windowMs: number): void {
    this.windowMs = Math.max(150, Math.min(800, windowMs))
  }

  update(input: TapInput): TapResult {
    const previous = this.last
    if (previous && previous.target === input.target && input.timestamp - previous.timestamp <= this.windowMs) {
      const intervalMs = Math.max(0, input.timestamp - previous.timestamp)
      this.last = null
      return {
        kind: 'double',
        target: input.target,
        at: input.timestamp,
        intervalMs,
        confidence: Math.min(previous.confidence, input.confidence),
      }
    }
    this.last = { ...input }
    return {
      kind: 'single',
      target: input.target,
      at: input.timestamp,
      intervalMs: null,
      confidence: input.confidence,
    }
  }

  peek(): TapInput | null {
    return this.last
  }

  reset(): void {
    this.last = null
  }
}
