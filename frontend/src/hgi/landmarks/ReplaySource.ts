import type { LandmarkSource } from './LandmarkSource'
import type { LandmarkFrame, RecordedFrame } from '../types'

// Feeds recorded landmark numbers back through the exact same pipeline so two
// filter settings can be compared on identical movement. No video is involved.
export class ReplaySource implements LandmarkSource {
  readonly kind = 'replay' as const
  speed: number

  private frames: RecordedFrame[]
  private listeners = new Set<(frame: LandmarkFrame) => void>()
  private endListeners = new Set<() => void>()
  private timer: number | null = null
  private index = 0
  private running = false

  constructor(frames: RecordedFrame[], speed = 1) {
    this.frames = frames
    this.speed = Math.max(0.25, Math.min(4, speed))
  }

  onFrame(listener: (frame: LandmarkFrame) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onEnd(listener: () => void): () => void {
    this.endListeners.add(listener)
    return () => this.endListeners.delete(listener)
  }

  getStream(): null {
    return null
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.index = 0
    this.schedule(0)
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    this.timer = window.setTimeout(() => {
      this.emitNext()
    }, delayMs)
  }

  private emitNext(): void {
    if (!this.running) return
    if (this.index >= this.frames.length) {
      this.running = false
      for (const listener of this.endListeners) listener()
      return
    }
    const frame = this.frames[this.index]
    const previous = this.index > 0 ? this.frames[this.index - 1] : null
    const delay = previous ? (frame.timestamp - previous.timestamp) / this.speed : 0
    this.index += 1
    const payload: LandmarkFrame = {
      hands: frame.hands,
      timestamp: performance.now(),
      source: 'replay',
      latencyMs: 0,
    }
    for (const listener of this.listeners) listener(payload)
    this.schedule(Math.max(0, Math.min(1000, delay)))
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    this.listeners.clear()
    this.endListeners.clear()
  }
}
