import { useCallback, useEffect, useState } from 'react'
import { Archive, Database, RefreshCw, RotateCcw } from 'lucide-react'
import { pushToast } from '../../services/toast'

type BackupItem = {
  id: string
  created_at: string
  size_bytes: number
  schema_version?: number
  safety_restore_point?: boolean
  valid?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DatabaseBackupControls() {
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/database/backups')
      const body = await response.json().catch(() => ({})) as { backups?: BackupItem[]; detail?: string }
      if (!response.ok) throw new Error(body.detail || 'Could not load database backups.')
      setBackups(Array.isArray(body.backups) ? body.backups : [])
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load database backups.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function createBackup() {
    setBusy(true)
    try {
      const response = await fetch('/api/database/backups', { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { backup?: BackupItem; detail?: string }
      if (!response.ok || !body.backup) throw new Error(body.detail || 'Backup creation failed.')
      pushToast('success', 'BOZZ backup created', `${formatBytes(body.backup.size_bytes)} saved locally.`)
      await refresh()
    } catch (caught) {
      pushToast('error', 'Backup failed', caught instanceof Error ? caught.message : 'Backup creation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreBackup(item: BackupItem) {
    const confirmed = window.confirm(
      `Restore this BOZZ database backup from ${new Date(item.created_at).toLocaleString()}? Current database contents will be replaced. BOZZ will first create a safety restore point.`,
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const response = await fetch(`/api/database/backups/${encodeURIComponent(item.id)}/restore`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { restored?: boolean; message?: string; detail?: string }
      if (!response.ok || body.restored !== true) throw new Error(body.detail || 'Database restore failed.')
      pushToast('success', 'Database restored', body.message || 'The safety restore point was created.')
      window.dispatchEvent(new Event('bozz:identity-changed'))
      window.setTimeout(() => window.location.reload(), 900)
    } catch (caught) {
      pushToast('error', 'Restore failed', caught instanceof Error ? caught.message : 'Database restore failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-group database-backup-controls" aria-label="Database backup and restore">
      <div className="database-backup-controls__header">
        <h3><Database /> Local database backups</h3>
        <button type="button" onClick={() => void refresh()} disabled={loading || busy} aria-label="Refresh backups">
          <RefreshCw />
        </button>
      </div>
      <p>Backups stay on this computer. Restore validates the database and creates a safety copy before replacing current data.</p>
      <button type="button" className="database-backup-controls__create" onClick={() => void createBackup()} disabled={busy}>
        <Archive /> {busy ? 'Working…' : 'Create backup now'}
      </button>
      {error && <p className="database-backup-controls__error" role="alert">{error}</p>}
      <ul>
        {backups.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.safety_restore_point ? 'Safety restore point' : 'Backup'}</strong>
              <small>{new Date(item.created_at).toLocaleString()} · {formatBytes(item.size_bytes)}</small>
              {!item.valid && <small className="database-backup-controls__error">Invalid backup</small>}
            </span>
            <button type="button" onClick={() => void restoreBackup(item)} disabled={busy || item.valid === false}>
              <RotateCcw /> Restore
            </button>
          </li>
        ))}
      </ul>
      {!loading && !error && backups.length === 0 && <small>No backups created yet.</small>}
    </section>
  )
}
