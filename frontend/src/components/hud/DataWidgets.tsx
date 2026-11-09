import { useEffect, useState } from 'react'
import { Clock, Cpu, MemoryStick } from 'lucide-react'
import { loadHistory, onLocalStoreChange } from '../../services/localStore'
import type { HistoryEntry, HistoryStatus } from '../../types/bozz'

const STATUS_LABEL: Record<HistoryStatus, string> = {
  done: 'Done',
  running: 'In progress',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

function formatTime(at: number): string {
  if (!Number.isFinite(at)) return 'Time unavailable'
  return new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export function DataWidgets() {
  const [lastTask, setLastTask] = useState<HistoryEntry | null>(() => loadHistory()[0] ?? null)

  useEffect(
    () => onLocalStoreChange(() => setLastTask(loadHistory()[0] ?? null)),
    [],
  )

  return (
    <section className="data-widgets" aria-label="Optional live widgets">
      <article className="data-widget">
        <header><Cpu /><span>CPU</span></header>
        <strong>Not connected</strong>
        <small>The local backend does not expose CPU metrics yet.</small>
      </article>
      <article className="data-widget">
        <header><MemoryStick /><span>RAM</span></header>
        <strong>Not connected</strong>
        <small>The local backend does not expose memory metrics yet.</small>
      </article>
      <article className="data-widget">
        <header><Clock /><span>Last task</span></header>
        {lastTask ? (
          <>
            <strong>{lastTask.title}</strong>
            <small>{STATUS_LABEL[lastTask.status]} · {formatTime(lastTask.updatedAt)}</small>
          </>
        ) : (
          <>
            <strong>No tasks yet</strong>
            <small>Real chat and workflow outcomes appear here.</small>
          </>
        )}
      </article>
    </section>
  )
}
