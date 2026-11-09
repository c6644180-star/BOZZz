function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(0.0001, cutoff))
  return 1 / (1 + tau / Math.max(0.0001, dt))
}

class LowPassFilter {
  private value: number | null = null

  filter(input: number, alpha: number): number {
    this.value = this.value === null ? input : alpha * input + (1 - alpha) * this.value
    return this.value
  }

  get last(): number | null {
    return this.value
  }

  reset(): void {
    this.value = null
  }
}

// Casiez, Roussel & Vogel (2012) One Euro filter. Low cutoff removes jitter at
// rest, beta raises the cutoff while the hand moves so fast motion stays crisp.
export class OneEuroFilter {
  minCutoff: number
  beta: number
  dCutoff: number
  freq: number

  private signal = new LowPassFilter()
  private derivative = new LowPassFilter()
  private lastInput: number | null = null
  private lastTime: number | null = null

  constructor(minCutoff = 1.2, beta = 0.35, dCutoff = 1, freq = 20) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
    this.freq = freq
  }

  filter(input: number, timestampMs: number): number {
    if (!Number.isFinite(input)) return this.lastValue

    let dt = this.freq > 0 ? 1 / this.freq : 0.05
    if (this.lastTime !== null && Number.isFinite(timestampMs) && timestampMs > this.lastTime) {
      dt = (timestampMs - this.lastTime) / 1000
    }
    dt = Math.min(0.5, Math.max(1 / 240, dt))

    const rawDerivative = this.lastInput === null ? 0 : (input - this.lastInput) / dt
    const filteredDerivative = this.derivative.filter(rawDerivative, smoothingFactor(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative)
    const result = this.signal.filter(input, smoothingFactor(cutoff, dt))

    this.lastInput = input
    this.lastTime = timestampMs
    return result
  }

  get lastValue(): number {
    return this.signal.last ?? 0
  }

  get velocity(): number {
    return this.derivative.last ?? 0
  }

  reset(): void {
    this.signal.reset()
    this.derivative.reset()
    this.lastInput = null
    this.lastTime = null
  }
}
