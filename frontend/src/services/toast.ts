export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  detail?: string
}

const MAX_TOASTS = 4
const listeners = new Set<() => void>()
const timers = new Map<string, number>()
let toasts: Toast[] = []

export function getToasts(): Toast[] {
  return toasts
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function dismissToast(id: string) {
  const timer = timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(id)
  }
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function pushToast(tone: ToastTone, title: string, detail?: string, ttl = 6000): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  toasts = [...toasts.slice(-(MAX_TOASTS - 1)), { id, tone, title, detail }]
  emit()
  if (ttl > 0) {
    timers.set(id, window.setTimeout(() => dismissToast(id), ttl))
  }
  return id
}
