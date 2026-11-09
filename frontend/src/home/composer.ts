export const COMPOSER_IDLE_MS = 8000

/** Keys that already have their own meaning on the home screen. */
const RESERVED_KEYS = new Set(['/', '?', ' '])

/**
 * Letters with a single-key shortcut. A first press waits briefly: if another
 * character arrives the pair is typed into the composer instead of toggling a
 * panel, so "chat" opens the input while a lone "c" still opens Chat.
 */
export const SHORTCUT_LETTERS: Record<string, 'history' | 'chat' | 'nav'> = {
  h: 'history',
  c: 'chat',
  n: 'nav',
}

export const SHORTCUT_DELAY_MS = 260

export interface ComposerIdleState {
  open: boolean
  focused: boolean
  hasText: boolean
}

/** Collapse only when the bar is open, unfocused, and empty. */
export function shouldCollapseComposer(state: ComposerIdleState): boolean {
  return state.open && !state.focused && !state.hasText
}

export class ComposerIdleTimer {
  private timer: ReturnType<typeof setTimeout> | null = null

  private readonly onCollapse: () => void

  private readonly timeoutMs: number

  constructor(onCollapse: () => void, timeoutMs: number = COMPOSER_IDLE_MS) {
    this.onCollapse = onCollapse
    this.timeoutMs = timeoutMs
  }

  sync(state: ComposerIdleState): void {
    this.cancel()
    if (!shouldCollapseComposer(state)) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.onCollapse()
    }, this.timeoutMs)
  }

  cancel(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.cancel()
  }
}

export interface TypingKey {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  editable: boolean
}

/**
 * Typing anywhere on the home screen opens the composer, except while a field
 * already has focus, with modifiers held, or for keys reserved above.
 */
export function shouldOpenComposerOnKey(input: TypingKey): boolean {
  if (input.editable) return false
  if (input.ctrlKey || input.metaKey || input.altKey) return false
  if (input.key.length !== 1) return false
  return !RESERVED_KEYS.has(input.key.toLowerCase())
}
