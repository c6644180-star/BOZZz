export interface TaskResultSignal {
  ok: boolean
}

type Listener = (result: TaskResultSignal) => void

const listeners = new Set<Listener>()

export function onTaskResult(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitTaskResult(result: TaskResultSignal): void {
  for (const listener of listeners) listener(result)
}
