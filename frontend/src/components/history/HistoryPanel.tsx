import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { localHistory, loadWorkflowHistory, sortHistory } from '../../services/history'
import { onLocalStoreChange } from '../../services/localStore'
import type { ConnStatus, HistoryEntry, HistoryStatus } from '../../types/bozz'

const STATUS: Record<HistoryStatus, { label: string; icon: typeof CheckCircle2 }> = {
  done: { label: 'Done', icon: CheckCircle2 },
  running: { label: 'In progress', icon: Clock },
  cancelled: { label: 'Cancelled', icon: XCircle },
  failed: { label: 'Failed', icon: AlertTriangle },
}

function formatTime(at: number): string {
  if (!Number.isFinite(at)) return 'Time unavailable'
  return new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export function HistoryPanel({ backend, onClose }: { backend: ConnStatus; onClose: () => void }) {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<HistoryEntry[]>(() => localHistory())
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      const local = localHistory()
      if (backend !== 'online') {
        await Promise.resolve()
        if (!alive) return
        setEntries(local)
        setNote('Workflow runs are hidden while the local backend is offline.')
        setLoading(false)
        return
      }
      try {
        const workflow = await loadWorkflowHistory()
        if (!alive) return
        setEntries(sortHistory([...local, ...workflow]))
        setNote(null)
      } catch {
        if (!alive) return
        setEntries(local)
        setNote('Workflow history could not be loaded from the local backend.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [backend, refresh])

  useEffect(
    () =>
      onLocalStoreChange(() =>
        setEntries((current) => sortHistory([...localHistory(), ...current.filter((entry) => entry.kind === 'task')])),
      ),
    [],
  )

  return (
    <div className="history-panel" aria-busy={loading}>
      <div className="panel-toolbar">
        <span>{entries.length === 1 ? '1 item' : `${entries.length} items`}</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setLoading(true)
            setRefresh((value) => value + 1)
          }}
          aria-label="Refresh history"
          title="Refresh"
        >
          <RefreshCw />
        </button>
      </div>

      {note && <p className="panel-note">{note}</p>}

      {loading && (
        <p className="panel-loading" role="status">
          <Loader2 aria-hidden="true" />
          Loading history…
        </p>
      )}

      {entries.length === 0 && !loading ? (
        <p className="panel-empty">
          No history yet. Send a message or plan a workflow action and its real outcome will appear here.
        </p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => {
            const meta = STATUS[entry.status]
            const Icon = meta.icon
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="history-item"
                  onClick={() => {
                    onClose()
                    navigate(entry.href)
                  }}
                >
                  <span className={`history-status history-status--${entry.status}`}>
                    <Icon />
                    {meta.label}
                  </span>
                  <strong>{entry.title}</strong>
                  <small>
                    {entry.kind === 'task' ? 'Workflow run' : 'Conversation'} · {formatTime(entry.updatedAt)}
                  </small>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
