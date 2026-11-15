import { gestureBus } from '../bus/GestureBus'
import { mapCameraToViewport } from '../geometry'
import { DwellTracker, loadCursorAssist, snapPoint, type Box } from '../cursorAssist'
import type { HgiBindings } from '../types'

const OVERLAY = '.hgi-hud, .hgi-cursor, .hgi-desktop-banner, .hgi-desktop-overlay'
const DANGER = '[data-gesture-guard], .delete-btn, .command-bar__send, button[type="submit"]'
const INTERACTIVE = 'button, a[href], [role="button"], [role="switch"], input:not([type="hidden"]), select, textarea, summary'
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
  // Where actions land. This is the raw smoothed cursor, optionally pulled toward a nearby control.
  private aim = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  private targets: Array<{ box: Box; element: HTMLElement }> = []
  private targetsAt = 0
  private readonly dwell = new DwellTracker(loadCursorAssist().dwellMs)
  private readonly dwellKeys = new WeakMap<HTMLElement, string>()
  private nextDwellKey = 1
  private lastDwellNoticeAt = 0

  constructor(bindings: HgiBindings, callbacks: CursorCallbacks) {
    this.bindings = bindings
    this.callbacks = callbacks
  }

  start(): void {
    this.stop()
    this.hasCursor = false
    this.targets = []
    this.targetsAt = 0
    this.dwell.reset()
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
        this.updateAim()
        this.callbacks.onCursor(this.aim.x, this.aim.y)
        if (this.dragging && performance.now() - this.lastDragMove > 40) {
          this.lastDragMove = performance.now()
          mouse(this.dragging, 'mousemove', this.aim.x, this.aim.y)
        }
        this.runDwell()
      }),
      gestureBus.on('gesture.pinch_start', (payload) => {
        this.pinchStartedAt = payload.timestamp
      }),
      gestureBus.on('gesture.pinch_hold', () => {
        if (this.bindings.cursorClick !== 'pinch' || this.dragging) return
        const element = targetAt(this.aim.x, this.aim.y)
        if (!element || isDangerous(element)) return
        this.dragging = element
        this.lastDragMove = performance.now()
        mouse(element, 'mousedown', this.aim.x, this.aim.y)
      }),
      gestureBus.on('gesture.pinch_end', (payload) => {
        if (this.dragging) {
          mouse(this.dragging, 'mouseup', this.aim.x, this.aim.y, 0)
          this.dragging = null
          return
        }
        if (this.bindings.cursorClick !== 'pinch') return
        if (!payload.clickAllowed || payload.timestamp - this.pinchStartedAt < 60) return
        if (payload.timestamp - this.lastClickAt < 250) return
        this.lastClickAt = payload.timestamp
        const result = gestureClickAt(this.aim.x, this.aim.y)
        if (result === 'blocked') this.callbacks.onNotice('Gesture click blocked until you confirm the dialog.')
      }),
      gestureBus.on('gesture.scroll', (payload) => {
        if (payload.gesture !== this.bindings.cursorScroll) return
        scrollAtPoint(this.aim.x, this.aim.y, payload.delta)
      }),
      gestureBus.on('gesture.recognized', (payload) => {
        if (this.bindings.cursorClick === 'pinch') return
        if (payload.name !== this.bindings.cursorClick) return
        if (performance.now() - this.lastGenericClickAt < 800) return
        this.lastGenericClickAt = performance.now()
        const result = gestureClickAt(this.aim.x, this.aim.y)
        if (result === 'blocked') this.callbacks.onNotice('Gesture click blocked until you confirm the dialog.')
      }),
    )
  }

  updateBindings(bindings: HgiBindings): void {
    this.bindings = bindings
  }

  get position(): { x: number; y: number } {
    return { ...this.aim }
  }

  /** Cache on-screen interactive controls (refreshed a few times a second, not per frame). */
  private refreshTargets(): void {
    const now = performance.now()
    if (now - this.targetsAt < 300) return
    this.targetsAt = now
    const found: Array<{ box: Box; element: HTMLElement }> = []
    const elements = document.querySelectorAll<HTMLElement>(INTERACTIVE)
    for (let index = 0; index < elements.length && found.length < 250; index += 1) {
      const element = elements[index]
      if (element.closest(OVERLAY) || (element as HTMLButtonElement).disabled) continue
      if (element.getAttribute('aria-hidden') === 'true') continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) continue
      if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) continue
      if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) continue
      found.push({ box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, element })
    }
    this.targets = found
  }

  private updateAim(): void {
    const assist = loadCursorAssist()
    if (!assist.snap) {
      this.aim = { x: this.cursor.x, y: this.cursor.y }
      return
    }
    this.refreshTargets()
    const snapped = snapPoint(
      this.cursor.x,
      this.cursor.y,
      this.targets.map((target) => target.box),
      assist.snapRadius,
    )
    this.aim = { x: snapped.x, y: snapped.y }
  }

  /** Optional hover-to-click. Never clicks risky controls; those still need a pinch and a confirm. */
  private runDwell(): void {
    const assist = loadCursorAssist()
    const root = document.documentElement.style
    if (!assist.dwell || this.dragging) {
      root.setProperty('--hgi-dwell', '0')
      this.dwell.reset()
      return
    }
    this.dwell.setDwellMs(assist.dwellMs)
    this.refreshTargets()
    const hit = targetAt(this.aim.x, this.aim.y)
    const element = hit && this.targets.some((target) => target.element === hit) ? hit : null
    let key: string | null = null
    if (element) {
      key = this.dwellKeys.get(element) ?? null
      if (!key) {
        key = `t${this.nextDwellKey++}`
        this.dwellKeys.set(element, key)
      }
    }
    const state = this.dwell.update(this.aim.x, this.aim.y, key, performance.now())
    root.setProperty('--hgi-dwell', String(state.progress))
    if (!state.fire || !element) return
    if (isDangerous(element)) {
      const now = performance.now()
      if (now - this.lastDwellNoticeAt > 4000) {
        this.lastDwellNoticeAt = now
        this.callbacks.onNotice('Hover-click skips risky controls. Pinch to confirm those.')
      }
      return
    }
    element.click()
  }

  stop(): void {
    document.documentElement.style.setProperty('--hgi-dwell', '0')
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes = []
    if (this.dragging) {
      mouse(this.dragging, 'mouseup', this.aim.x, this.aim.y, 0)
      this.dragging = null
    }
  }
}