export type PinchPhase = 'idle' | 'hover' | 'pinch_start' | 'pinch_hold' | 'pinch_end'

export interface PinchConfig {
  onThreshold: number
  offThreshold: number
  enterMs: number
  holdMs: number
  tapMaxMs: number
  lostMs: number
  cooldownMs: number
  minConfidence: number
}

export interface PinchOutput {
  phase: PinchPhase
  pressed: boolean
  justStarted: boolean
  justHeld: boolean
  justEnded: boolean
  clickAllowed: boolean
  shortPinch: boolean
  tap: boolean
  heldMs: number
}

export const DEFAULT_PINCH_CONFIG: PinchConfig = {
  onThreshold: 0.3,
  offThreshold: 0.48,
  enterMs: 70,
  holdMs: 120,
  tapMaxMs: 260,
  lostMs: 200,
  cooldownMs: 260,
  minConfidence: 0.55,
}

function emptyOutput(phase: PinchPhase = 'idle', heldMs = 0): PinchOutput {
  return {
    phase,
    pressed: false,
    justStarted: false,
    justHeld: false,
    justEnded: false,
    clickAllowed: false,
    shortPinch: false,
    tap: false,
    heldMs,
  }
}

// Per-hand pinch state with a minimum enter time (a transition, not one
// frame), hysteresis, a minimum hold before a click, tap classification, a
// short cooldown, and a 200 ms grace period for lost hands.
export class PinchStateMachine {
  config: PinchConfig

  private pressed = false
  private startedAt = 0
  private pendingSince: number | null = null
  private lastSeen = 0
  private seen = false
  private lastEndedAt = -Infinity
  private heldEmitted = false
  private phase: PinchPhase = 'idle'
  private endedOnce = false

  constructor(config: Partial<PinchConfig> = {}) {
    this.config = { ...DEFAULT_PINCH_CONFIG, ...config }
  }

  get isPressed(): boolean {
    return this.pressed
  }

  update(ratio: number, confidence: number, timestamp: number): PinchOutput {
    this.lastSeen = timestamp
    this.seen = true

    if (confidence < this.config.minConfidence) {
      // An uncertain recognition is never a command. Keep the current state
      // briefly so a single bad frame does not create a click.
      this.pendingSince = null
      return emptyOutput(this.phase, this.pressed ? timestamp - this.startedAt : 0)
    }

    if (!this.pressed) {
      const inCooldown = timestamp - this.lastEndedAt < this.config.cooldownMs
      if (inCooldown) {
        this.pendingSince = null
        this.phase = ratio <= this.config.offThreshold ? 'hover' : 'idle'
        return emptyOutput(this.phase)
      }
      if (ratio <= this.config.onThreshold) {
        if (this.pendingSince === null) this.pendingSince = timestamp
        const waited = timestamp - this.pendingSince
        if (waited >= this.config.enterMs) {
          this.pressed = true
          // Hold time starts when the pinch is confirmed. The enter debounce is
          // not finger contact, so it must not let a flick count as a click.
          this.startedAt = timestamp
          this.pendingSince = null
          this.heldEmitted = false
          this.endedOnce = false
          this.phase = 'pinch_start'
          return {
            phase: this.phase,
            pressed: true,
            justStarted: true,
            justHeld: false,
            justEnded: false,
            clickAllowed: false,
            shortPinch: false,
            tap: false,
            heldMs: 0,
          }
        }
        this.phase = 'hover'
        return emptyOutput(this.phase)
      }
      this.pendingSince = null
      this.phase = ratio <= this.config.offThreshold ? 'hover' : 'idle'
      if (this.endedOnce && this.phase === 'idle') this.endedOnce = false
      return emptyOutput(this.phase)
    }

    if (ratio >= this.config.offThreshold) {
      const heldMs = timestamp - this.startedAt
      const clickAllowed = heldMs >= this.config.holdMs
      this.pressed = false
      this.lastEndedAt = timestamp
      this.phase = 'pinch_end'
      this.endedOnce = true
      return {
        phase: 'pinch_end',
        pressed: false,
        justStarted: false,
        justHeld: false,
        justEnded: true,
        clickAllowed,
        shortPinch: !clickAllowed,
        tap: !clickAllowed && heldMs > 0 && heldMs <= this.config.tapMaxMs,
        heldMs,
      }
    }

    if (!this.heldEmitted && timestamp - this.startedAt >= this.config.holdMs) {
      this.heldEmitted = true
      this.phase = 'pinch_hold'
      return {
        phase: 'pinch_hold',
        pressed: true,
        justStarted: false,
        justHeld: true,
        justEnded: false,
        clickAllowed: false,
        shortPinch: false,
        tap: false,
        heldMs: timestamp - this.startedAt,
      }
    }

    this.phase = this.heldEmitted ? 'pinch_hold' : 'pinch_start'
    return {
      phase: this.phase,
      pressed: true,
      justStarted: false,
      justHeld: false,
      justEnded: false,
      clickAllowed: false,
      shortPinch: false,
      tap: false,
      heldMs: timestamp - this.startedAt,
    }
  }

  // Called when no landmarks arrive for this hand. Returns an end event once
  // the 200 ms grace period expires.
  lost(timestamp: number): PinchOutput | null {
    if (!this.seen) return null
    if (timestamp - this.lastSeen < this.config.lostMs) return null
    if (this.pressed) {
      const heldMs = timestamp - this.startedAt
      this.pressed = false
      this.lastEndedAt = timestamp
      this.phase = 'idle'
      return {
        phase: 'pinch_end',
        pressed: false,
        justStarted: false,
        justHeld: false,
        justEnded: true,
        clickAllowed: false,
        shortPinch: false,
        tap: false,
        heldMs,
      }
    }
    this.phase = 'idle'
    return null
  }

  reset(): void {
    this.pressed = false
    this.startedAt = 0
    this.pendingSince = null
    this.lastSeen = 0
    this.seen = false
    this.lastEndedAt = -Infinity
    this.heldEmitted = false
    this.phase = 'idle'
    this.endedOnce = false
  }
}
