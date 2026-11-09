import { gestureBus } from '../bus/GestureBus'
import { clamp } from '../geometry'
import type { HgiBindings, Handedness } from '../types'

export interface OrbCallbacks {
  onTransform: (rotationDeg: number, zoom: number) => void
}

// Direct manipulation for the command-center orb. Rotation and zoom are
// written as CSS variables on the next animation frame so gesture processing
// never shares a render loop with the orb.
export class OrbMode {
  bindings: HgiBindings
  private callbacks: OrbCallbacks
  private unsubscribes: Array<() => void> = []
  private rotation = 0
  private zoom = 1
  private applyScheduled = false
  private activeSpin = false
  private lastSpinAt = 0
  private genericPrevX = new Map<Handedness, number>()
  private activeZoom = false
  private zoomUntil = 0
  private lastZoomDistance: number | null = null
  private lastResetAt = 0

  constructor(bindings: HgiBindings, callbacks: OrbCallbacks) {
    this.bindings = bindings
    this.callbacks = callbacks
  }

  start(): void {
    this.stop()
    this.unsubscribes.push(
      gestureBus.on('gesture.rotate', (payload) => {
        if (this.bindings.orbSpin !== 'pinch') return
        this.rotation -= payload.delta * 220
        this.scheduleApply()
      }),
      gestureBus.on('gesture.zoom', (payload) => {
        if (this.bindings.orbZoom !== 'two_hand_pinch') return
        this.zoom = clamp(this.zoom * payload.scale, 0.65, 1.6)
        this.scheduleApply()
      }),
      gestureBus.on('gesture.recognized', (payload) => {
        const now = payload.timestamp
        if (payload.name === this.bindings.orbSpin) {
          this.activeSpin = true
          this.lastSpinAt = now
        }
        if (payload.name === this.bindings.orbZoom) {
          this.activeZoom = true
          this.zoomUntil = now + 600
          if (payload.twoHandDistance !== null) this.lastZoomDistance = payload.twoHandDistance
        }
        if (payload.name === this.bindings.orbReset && now - this.lastResetAt > 800) {
          this.lastResetAt = now
          this.reset()
        }
      }),
      gestureBus.on('gesture.pinch_end', (payload) => {
        if (this.bindings.orbSpin === 'pinch') {
          this.genericPrevX.delete(payload.hand)
        }
      }),
      gestureBus.on('gesture.move', (payload) => {
        const now = payload.timestamp
        if (this.bindings.orbSpin !== 'pinch') {
          if (this.activeSpin && now - this.lastSpinAt < 600) {
            const previous = this.genericPrevX.get(payload.hand)
            if (previous !== undefined) {
              this.rotation -= (payload.x - previous) * 220
              this.scheduleApply()
            }
            this.genericPrevX.set(payload.hand, payload.x)
          } else {
            this.activeSpin = false
            this.genericPrevX.delete(payload.hand)
          }
        }
        if (this.bindings.orbZoom !== 'two_hand_pinch' && this.activeZoom && now < this.zoomUntil) {
          if (payload.twoHandDistance !== null) {
            if (this.lastZoomDistance !== null && payload.twoHandDistance > 0.05) {
              this.zoom = clamp(this.zoom * (payload.twoHandDistance / this.lastZoomDistance), 0.65, 1.6)
              this.scheduleApply()
            }
            this.lastZoomDistance = payload.twoHandDistance
          }
        } else if (now >= this.zoomUntil) {
          this.activeZoom = false
          this.lastZoomDistance = null
        }
      }),
    )
  }

  updateBindings(bindings: HgiBindings): void {
    this.bindings = bindings
  }

  private scheduleApply(): void {
    if (this.applyScheduled) return
    this.applyScheduled = true
    requestAnimationFrame(() => {
      this.applyScheduled = false
      this.callbacks.onTransform(this.rotation, this.zoom)
    })
  }

  reset(): void {
    this.rotation = 0
    this.zoom = 1
    this.scheduleApply()
  }

  restore(rotation: number, zoom: number): void {
    this.rotation = rotation
    this.zoom = clamp(zoom, 0.65, 1.6)
    this.scheduleApply()
  }

  get current(): { rotation: number; zoom: number } {
    return { rotation: this.rotation, zoom: this.zoom }
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes = []
    this.activeSpin = false
    this.activeZoom = false
    this.genericPrevX.clear()
    this.lastZoomDistance = null
  }
}
