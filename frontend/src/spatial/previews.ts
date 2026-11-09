import { previewFile, type FilePreview } from '../services/files'

/** At most 30 previews are requested at once; the rest wait in a first-in queue. */
const MAX_CONCURRENT_PREVIEWS = 30

let active = 0

interface Job {
  run: () => void
  abort: () => void
  signal?: AbortSignal
}

const queue: Job[] = []
const inflight = new Map<string, Promise<FilePreview>>()

function pump(): void {
  while (active < MAX_CONCURRENT_PREVIEWS && queue.length) {
    const next = queue.shift()
    if (!next) break
    if (next.signal?.aborted) {
      next.abort()
      continue
    }
    next.run()
  }
}

function release(): void {
  active = Math.max(0, active - 1)
  pump()
}

export function loadPreview(path: string, signal?: AbortSignal): Promise<FilePreview> {
  // Only signal-free requests are shared. A caller with its own AbortSignal must
  // get its own request, otherwise an aborted mount can poison the next one.
  if (!signal) {
    const existing = inflight.get(path)
    if (existing) return existing
  }

  let settled = false
  const promise = new Promise<FilePreview>((resolve, reject) => {
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      if (!signal) inflight.delete(path)
      complete()
    }
    const abort = () => finish(() => reject(new DOMException('The preview was cancelled.', 'AbortError')))
    const run = () => {
      if (signal?.aborted) {
        abort()
        return
      }
      active += 1
      previewFile(path, signal)
        .then(
          (preview) => finish(() => resolve(preview)),
          (error: unknown) => finish(() => reject(error)),
        )
        .finally(release)
    }

    if (signal?.aborted) {
      abort()
      return
    }
    if (active < MAX_CONCURRENT_PREVIEWS) run()
    else {
      queue.push({ run, abort, signal })
      signal?.addEventListener('abort', abort, { once: true })
    }
  })

  if (!signal) inflight.set(path, promise)
  return promise
}
