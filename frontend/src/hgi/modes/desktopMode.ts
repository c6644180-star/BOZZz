import { gestureBus } from '../bus/GestureBus'
import { clamp01 } from '../geometry'
import type { DesktopCommand, DesktopSocket } from '../desktop/desktopSocket'
import type { HgiBindings } from '../types'

export interface DesktopModeSettings {
  sensitivity: number
  smoothing: number
  minConfidence: number
  clickDelayMs: number
}

export interface DesktopModeOptions {
  onApprove?: () => void
  onPushToTalkStart?: () => void
  onPushToTalkEnd?: () => void
  onNotice?: (message: string) => void
}

// Turns recognised gestures into desktop actions. Mouse movement stays on the
// legacy socket path (no per-frame result flood); discrete Tier 1 work
// (window switch, browser zoom) uses the typed action endpoint. The backend
// still owns confidence gates, the rate limit, the allowlist and the emergency
// stop, so this class can never invent an action id.
export class DesktopMode {
  bindings: HgiBindings
  private socket: DesktopSocket
  private settings: DesktopModeSettings
  private options: DesktopModeOptions
  private unsubscribes: Array<() => void> = []
  private point = { x: 0.5, y: 0.5 }
  private hasPoint = false
  private pinchStartedAt = 0
  private dragging = false
  private lastMoveAt = 0
  private lastTrackingAt = 0
  private lastGenericClickAt = 0
  private lastWindowSwitchAt = 0
  private lastZoomAt = 0
  private lastApproveAt = 0
  private clickTimer: number | null = null
  private pushToTalkTimer: number | null = null
  private pushToTalkActive = false

  constructor(socket: DesktopSocket, bindings: HgiBindings, settings: DesktopModeSettings, options: DesktopModeOptions = {}) {
    this.socket = socket
    this.bindings = bindings
    this.settings = settings
    this.options = options
  }

  start(): void {
    this.stop()
    this.hasPoint = false
    this.dragging = false
    this.unsubscribes.push(
      gestureBus.on('gesture.move', (payload) => {
        if (payload.confidence < this.settings.minConfidence) return
        const target = {
          x: clamp01(0.5 + (clamp01(1 - payload.x) - 0.5) * this.settings.sensitivity),
          y: clamp01(0.5 + (payload.y - 0.5) * this.settings.sensitivity),
        }
        if (!this.hasPoint) {
          this.point = target
          this.hasPoint = true
        } else {
          const alpha = 1 - this.settings.smoothing * 0.9
          this.point = {
            x: this.point.x + (target.x - this.point.x) * alpha,
            y: this.point.y + (target.y - this.point.y) * alpha,
          }
        }
        const now = payload.timestamp
        if (now - this.lastTrackingAt >= 1000) {
          this.lastTrackingAt = now
          this.socket.sendTracking()
        }
        if (now - this.lastMoveAt < 30) return
        this.lastMoveAt = now
        const command: DesktopCommand = this.dragging
          ? { type: 'drag_move', x: this.point.x, y: this.point.y, confidence: payload.confidence }
          : { type: 'move', x: this.point.x, y: this.point.y, confidence: payload.confidence }
        this.socket.send(command)
      }),
      gestureBus.on('gesture.pinch_start', (payload) => {
        this.pinchStartedAt = payload.timestamp
        this.cancelDelayedClick()
      }),
      gestureBus.on('gesture.pinch_hold', (payload) => {
        if (this.bindings.desktopDrag !== 'pinch' || this.dragging || !this.hasPoint) return
        if (payload.confidence < this.settings.minConfidence) return
        this.dragging = true
        this.cancelDelayedClick()
        this.socket.send({ type: 'drag_start', x: this.point.x, y: this.point.y, confidence: payload.confidence })
      }),
      gestureBus.on('gesture.pinch_end', (payload) => {
        if (payload.confidence < this.settings.minConfidence && this.dragging) {
          // Safety: always release a drag, even when the confidence collapses.
          this.socket.send({ type: 'drag_end', x: this.point.x, y: this.point.y, confidence: 0 })
          this.dragging = false
          return
        }
        if (this.dragging) {
          this.socket.send({ type: 'drag_end', x: this.point.x, y: this.point.y, confidence: payload.confidence })
          this.dragging = false
          return
        }
        if (this.bindings.desktopClick !== 'pinch' || !payload.clickAllowed || !this.hasPoint) return
        if (payload.timestamp - this.pinchStartedAt < 60) return
        if (this.settings.clickDelayMs <= 0) {
          this.socket.send({ type: 'click', x: this.point.x, y: this.point.y, confidence: payload.confidence })
          return
        }
        this.cancelDelayedClick()
        this.clickTimer = window.setTimeout(() => {
          this.clickTimer = null
          if (!this.hasPoint) return
          this.socket.send({ type: 'click', x: this.point.x, y: this.point.y, confidence: 0.7 })
        }, this.settings.clickDelayMs)
      }),
      gestureBus.on('gesture.scroll', (payload) => {
        if (payload.gesture !== this.bindings.desktopScroll) return
        if (payload.confidence < this.settings.minConfidence) return
        this.socket.send({ type: 'scroll', delta: Math.round(payload.delta), confidence: payload.confidence })
      }),
      gestureBus.on('gesture.flick', (payload) => {
        if (this.bindings.desktopWindow !== 'flick') return
        if (payload.direction !== 'left' && payload.direction !== 'right') return
        if (payload.confidence < this.settings.minConfidence) return
        if (performance.now() - this.lastWindowSwitchAt < 1000) return
        this.lastWindowSwitchAt = performance.now()
        this.socket.sendAction('window.switch', {}, payload.confidence)
      }),
      gestureBus.on('gesture.zoom', (payload) => {
        if (this.bindings.desktopZoom !== 'two_hand_pinch') return
        if (payload.confidence < this.settings.minConfidence) return
        if (performance.now() - this.lastZoomAt < 700) return
        if (payload.scale > 1.015) {
          this.lastZoomAt = performance.now()
          this.socket.sendAction('browser.zoom_in', {}, payload.confidence)
        } else if (payload.scale < 0.985) {
          this.lastZoomAt = performance.now()
          this.socket.sendAction('browser.zoom_out', {}, payload.confidence)
        }
      }),
      gestureBus.on('gesture.recognized', (payload) => {
        this.handleRecognized(payload.name, payload.confidence, payload.heldMs)
      }),
    )
  }

  private handleRecognized(name: string, confidence: number, heldMs: number): void {
    if (confidence < this.settings.minConfidence) return

    if (name === this.bindings.desktopPushToTalk) {
      if (heldMs >= 1000) {
        if (!this.pushToTalkActive) {
          this.pushToTalkActive = true
          this.options.onPushToTalkStart?.()
        }
        if (this.pushToTalkTimer !== null) window.clearTimeout(this.pushToTalkTimer)
        this.pushToTalkTimer = window.setTimeout(() => {
          this.pushToTalkTimer = null
          if (!this.pushToTalkActive) return
          this.pushToTalkActive = false
          this.options.onPushToTalkEnd?.()
        }, 700)
      }
      return
    }
    if (this.pushToTalkActive) {
      this.pushToTalkActive = false
      if (this.pushToTalkTimer !== null) {
        window.clearTimeout(this.pushToTalkTimer)
        this.pushToTalkTimer = null
      }
      this.options.onPushToTalkEnd?.()
    }

    if (name === this.bindings.desktopApprove && heldMs >= 1500) {
      const now = performance.now()
      if (now - this.lastApproveAt < 2500) return
      this.lastApproveAt = now
      this.options.onApprove?.()
      return
    }

    if (this.bindings.desktopClick === 'pinch') return
    if (name !== this.bindings.desktopClick || !this.hasPoint) return
    if (performance.now() - this.lastGenericClickAt < 800) return
    this.lastGenericClickAt = performance.now()
    this.socket.send({ type: 'click', x: this.point.x, y: this.point.y, confidence })
  }

  private cancelDelayedClick(): void {
    if (this.clickTimer !== null) {
      window.clearTimeout(this.clickTimer)
      this.clickTimer = null
    }
  }

  updateBindings(bindings: HgiBindings): void {
    this.bindings = bindings
  }

  updateSettings(settings: DesktopModeSettings): void {
    this.settings = settings
  }

  get position(): { x: number; y: number } {
    return { ...this.point }
  }

  stop(): void {
    this.cancelDelayedClick()
    if (this.pushToTalkTimer !== null) {
      window.clearTimeout(this.pushToTalkTimer)
      this.pushToTalkTimer = null
    }
    if (this.pushToTalkActive) {
      this.pushToTalkActive = false
      this.options.onPushToTalkEnd?.()
    }
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes = []
    if (this.dragging) {
      this.socket.send({ type: 'drag_end', x: this.point.x, y: this.point.y, confidence: 0 })
      this.dragging = false
    }
  }
}
