import { gestureBus } from '../bus/GestureBus'
import { mapCameraToViewport } from '../geometry'
import type { HgiBindings } from '../types'

const OVERLAY = '.hgi-hud, .hgi-cursor, .hgi-desktop-banner, .hgi-desktop-overlay'
const DANGER = '[data-gesture-guard], .delete-btn, .command-bar__send, button[type="submit"]'
const DANGER_WORDS = /(delete|remove|send|publish|submit|erase|destroy|confirm|stop|emergency|approve|execute|reject)/i

function targetAt(x: number, y: number): HTMLElement | null {
  const element = document.elementFromPoint(x, y)
  if (!element || element.closest(OVERLAY)) return null
  return (element.closest('button, a, input, textarea, select, [role="button"], [role="switch"]') ??
    element) as HTMLElement
}

function isDangerous(element: HTMLElement): boolean {
  if (element.closest(DANGER)) return true
  const label = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`
  return DANGER_WORDS.test(label)
}

export function gestureClickAt(x: number, y: number): 'clicked' | 'blocked' | 'none' {
  const element = targetAt(x, y)
  if (!element) return 'none'
  if (isDangerous(element)) {
    const label = (element.getAttribute('aria-label') ?? element.textContent ?? 'this control').trim().slice(0, 60)
    if (!window.confirm(`Gesture click on "${label}". Confirm this action?`)) return 'blocked'
  }
  element.click()
  return 'clicked'
}

function scrollAtPoint(x: number, y: number, delta: number): void {
  let node = document.elementFromPoint(x, y) as HTMLElement | null
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2) {
      node.scrollBy({ top: delta, behavior: 'auto' })
      return
    }
    node = node.parentElement
  }
  window.scrollBy(0, delta)
}

function mouse(target: HTMLElement, type: string, x: number, y: number, buttons = 1): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
  })
  target.dispatchEvent(event)
}

export interface CursorCallbacks {
  onCursor: (x: number, y: number) => void
  onNotice: (message: string) => void
}

// In-page virtual cursor. A short pinch is a click, a long pinch becomes a
// drag, two fingers scroll, and an open palm pauses through the provider.
// Clicks on delete/send/publish controls always ask for confirmation first.
export class CursorMode {
  bindings: HgiBindings
  private callbacks: CursorCallbacks
  private unsubscribes: Array<() => void> = []
  private cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  private hasCursor = false
  private pinchStartedAt = 0
  private dragging: HTMLElement | null = null
  private lastDragMove = 0
  private lastClickAt = 0
  private lastGenericClickAt = 0

  constructor(bindings: HgiBindings, callbacks: CursorCallbacks) {
    this.bindings = bindings
    this.callbacks = callbacks
  }

  start(): void {
    this.stop()
    this.hasCursor = false
    this.unsubscribes.push(
      gestureBus.on('gesture.move', (payload) => {
        const next = mapCameraToViewport(payload.x, payload.y, window.innerWidth, window.innerHeight, true, 0.03)
        if (!this.hasCursor) {
          this.cursor = next
          this.hasCursor = true
        } else {
          this.cursor.x += (next.x - this.cursor.x) * 0.4
          this.cursor.y += (next.y - this.cursor.y) * 0.4
        }
        this.callbacks.onCursor(this.cursor.x, this.cursor.y)
        if (this.dragging && performance.now() - this.lastDragMove > 40) {
          this.lastDragMove = performance.now()
          mouse(this.dragging, 'mousemove', this.cursor.x, this.cursor.y)
        }
      }),
      gestureBus.on('gesture.pinch_start', (payload) => {
        this.pinchStartedAt = payload.timestamp
      }),
      gestureBus.on('gesture.pinch_hold', () => {
        if (this.bindings.cursorClick !== 'pinch' || this.dragging) return
        const element = targetAt(this.cursor.x, this.cursor.y)
        if (!element || isDangerous(element)) return
        this.dragging = element
        this.lastDragMove = performance.now()
        mouse(element, 'mousedown', this.cursor.x, this.cursor.y)
      }),
      gestureBus.on('gesture.pinch_end', (payload) => {
        if (this.dragging) {
          mouse(this.dragging, 'mouseup', this.cursor.x, this.cursor.y, 0)
          this.dragging = null
          return
        }
        if (this.bindings.cursorClick !== 'pinch') return
        if (!payload.clickAllowed || payload.timestamp - this.pinchStartedAt < 60) return
        if (payload.timestamp - this.lastClickAt < 250) return
        this.lastClickAt = payload.timestamp
        const result = gestureClickAt(this.cursor.x, this.cursor.y)
        if (result === 'blocked') this.callbacks.onNotice('Gesture click blocked until you confirm the dialog.')
      }),
      gestureBus.on('gesture.scroll', (payload) => {
        if (payload.gesture !== this.bindings.cursorScroll) return
        scrollAtPoint(this.cursor.x, this.cursor.y, payload.delta)
      }),
      gestureBus.on('gesture.recognized', (payload) => {
        if (this.bindings.cursorClick === 'pinch') return
        if (payload.name !== this.bindings.cursorClick) return
        if (performance.now() - this.lastGenericClickAt < 800) return
        this.lastGenericClickAt = performance.now()
        const result = gestureClickAt(this.cursor.x, this.cursor.y)
        if (result === 'blocked') this.callbacks.onNotice('Gesture click blocked until you confirm the dialog.')
      }),
    )
  }

  updateBindings(bindings: HgiBindings): void {
    this.bindings = bindings
  }

  get position(): { x: number; y: number } {
    return { ...this.cursor }
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes = []
    if (this.dragging) {
      mouse(this.dragging, 'mouseup', this.cursor.x, this.cursor.y, 0)
      this.dragging = null
    }
  }
}
