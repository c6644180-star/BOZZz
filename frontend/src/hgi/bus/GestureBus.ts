import type { GestureEventMap } from '../types'

type AnyListener = (payload: never) => void

export class GestureBus {
  private listeners = new Map<keyof GestureEventMap, Set<AnyListener>>()

  on<K extends keyof GestureEventMap>(event: K, listener: (payload: GestureEventMap[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set<AnyListener>()
      this.listeners.set(event, set)
    }
    set.add(listener as AnyListener)
    return () => {
      set?.delete(listener as AnyListener)
    }
  }

  emit<K extends keyof GestureEventMap>(event: K, payload: GestureEventMap[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      ;(listener as (value: GestureEventMap[K]) => void)(payload)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

// Every module subscribes to this one bus. No other hand-tracking path exists.
export const gestureBus = new GestureBus()
