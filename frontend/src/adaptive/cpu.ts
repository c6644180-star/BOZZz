export interface CpuReading {
  at: number
  load: number
  ramMb: number | null
}

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
}

export function computeMainThreadLoad(actualMs: number, expectedMs: number): number {
  if (!Number.isFinite(actualMs) || !Number.isFinite(expectedMs) || expectedMs <= 0) return 0
  return Math.min(1, Math.max(0, (actualMs - expectedMs) / expectedMs))
}

export function readRamMb(): number | null {
  if (typeof performance === 'undefined') return null
  const memory = (performance as PerformanceWithMemory).memory
  if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return null
  return Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
}

// Measures how late a 1 s timer runs on the main thread. That is a real load
// proxy available in every browser; it is NOT total system CPU.
export class CpuMonitor {
  private intervalMs: number
  private now: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private lastAt = 0
  private readings: CpuReading[] = []
  private listeners = new Set<(reading: CpuReading) => void>()
  private horizonMs: number

  constructor(options: { intervalMs?: number; now?: () => number; horizonMs?: number } = {}) {
    this.intervalMs = options.intervalMs ?? 1000
    this.now = options.now ?? (() => performance.now())
    this.horizonMs = options.horizonMs ?? 120_000
  }

  start(): void {
    if (this.timer !== null) return
    this.lastAt = this.now()
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        this.lastAt = this.now()
        return
      }
      this.record(this.now())
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  record(at: number): CpuReading {
    const elapsed = this.lastAt === 0 ? this.intervalMs : at - this.lastAt
    this.lastAt = at
    const reading: CpuReading = {
      at,
      load: computeMainThreadLoad(elapsed, this.intervalMs),
      ramMb: readRamMb(),
    }
    this.readings = [...this.readings.filter((item) => at - item.at <= this.horizonMs), reading]
    for (const listener of this.listeners) listener(reading)
    return reading
  }

  subscribe(listener: (reading: CpuReading) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  samples(): CpuReading[] {
    return this.readings.slice()
  }

  latest(): CpuReading | null {
    return this.readings.length > 0 ? this.readings[this.readings.length - 1] : null
  }

  averagePercent(): number | null {
    if (this.readings.length === 0) return null
    return Math.round((this.readings.reduce((sum, item) => sum + item.load, 0) / this.readings.length) * 100)
  }

  ramAverageMb(): number | null {
    const values = this.readings.map((item) => item.ramMb).filter((value): value is number => value !== null)
    return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }

  sustainedAbove(percent: number, seconds: number): boolean {
    if (this.readings.length === 0) return false
    const newest = this.readings[this.readings.length - 1]
    const windowStart = newest.at - seconds * 1000
    const window = this.readings.filter((item) => item.at >= windowStart)
    if (window.length < 3) return false
    const covered = window[window.length - 1].at - window[0].at
    if (covered < seconds * 1000 * 0.7) return false
    const average = window.reduce((sum, item) => sum + item.load, 0) / window.length
    return average * 100 >= percent
  }
}
