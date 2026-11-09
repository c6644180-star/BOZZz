import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleOff, Clock, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ModulePage } from '../components/layout/ModulePage'
import { ModulePermissions } from '../components/settings/ModulePermissions'
import { useModules } from '../hooks/useModules'
import { listAudit, type AuditEntry } from '../services/intent'
import type { ModuleError } from '../types/modules'

const PERMISSION_EVENTS = new Set([
  'permission_grant',
  'permission_revoke',
  'permission_denied',
])

function formatTime(iso: string | null): string {
  if (!iso) return 'recorded by the registry'
  const at = new Date(iso)
  return Number.isNaN(at.valueOf()) ? iso : at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ModulesPage() {
  const { snapshot, loading, offline, error, refresh } = useModules()
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [auditError, setAuditError] = useState<string | null>(null)

  useEffect(() => {
    if (offline) {
      // The audit list mirrors the registry; clearing it when the backend is gone is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAudit([])
      return
    }
    let alive = true
    void listAudit(60)
      .then(({ entries }) => {
        if (alive) setAudit(entries.filter((entry) => PERMISSION_EVENTS.has(entry.event)))
      })
      .catch((caught: unknown) => {
        if (alive) setAuditError(caught instanceof Error ? caught.message : 'Permission audit could not be loaded.')
      })
    return () => {
      alive = false
    }
  }, [offline, snapshot])

  const errors: ModuleError[] = [
    ...snapshot.errors,
    ...(offline
      ? [{
          module: 'backend',
          title: 'Backend offline',
          detail: 'Module registry is showing the local frontend fallback. Permission changes are disabled.',
          createdAt: null,
          outcome: 'error',
        }]
      : []),
    ...(error && !offline
      ? [{ module: 'registry', title: 'Registry error', detail: error, createdAt: null, outcome: 'error' }]
      : []),
  ]

  const ready = snapshot.modules.filter((module) => module.status === 'Ready').length
  const notConnected = snapshot.modules.filter((module) => module.status === 'Not connected').length

  return (
    <ModulePage
      title="Module Registry"
      subtitle="Every BOZZ module with its declared version, implementation status, capabilities and permissions. Status means installed code, not a sensor that happens to be idle."
      tone={offline ? 'preview' : 'live'}
    >
      <div className="module-registry-summary" aria-live="polite">
        <span><ShieldCheck /> Registry v{snapshot.registryVersion}</span>
        <span><CheckCircle2 /> {ready} ready</span>
        <span><CircleOff /> {notConnected} not connected</span>
        <span>{offline ? 'Frontend fallback' : 'Backend registry'}</span>
        <button type="button" className="icon-action" onClick={() => void refresh()} disabled={loading} aria-label="Refresh module registry">
          <RefreshCw />
        </button>
      </div>

      <section className="workflow-panel module-error-panel" aria-label="Module error panel">
        <div className="workflow-panel-head">
          <h2><AlertTriangle /> Error panel</h2>
          <span className="workspace-chip">{errors.length === 0 ? 'No errors' : `${errors.length} reported`}</span>
        </div>
        {errors.length === 0 ? (
          <p className="workflow-note">
            No module errors or permission denials are recorded. This panel only shows real backend errors, module
            errors, and denied permission attempts.
          </p>
        ) : (
          <ul className="module-error-list">
            {errors.map((item, index) => (
              <li key={`${item.module}-${item.title}-${index}`}>
                <AlertTriangle />
                <div>
                  <strong>{item.title} · {item.module}</strong>
                  <span>{item.detail}</span>
                  <small>{formatTime(item.createdAt)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModulePermissions variant="full" />

      <section className="workflow-panel module-audit-panel" aria-label="Permission audit log">
        <div className="workflow-panel-head">
          <h2><Clock /> Permission audit</h2>
          <span className="workspace-chip">{audit.length} entr{audit.length === 1 ? 'y' : 'ies'}</span>
        </div>
        {auditError && <p className="workflow-error" role="alert">{auditError}</p>}
        {audit.length === 0 ? (
          <p className="workflow-note">
            No permission changes have been recorded yet. Grants, revokes and denials appear here from the backend
            audit log.
          </p>
        ) : (
          <ul className="audit-list">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className={`audit-event event-${entry.outcome}`}>{entry.event}</span>
                <div>
                  <span>{entry.detail}</span>
                  <small>
                    {entry.target ?? 'no module'} · {formatTime(entry.created_at)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="workflow-note">
          Manage grants in <Link to="/settings#module-permissions">Settings → Module permissions</Link>.
        </p>
      </section>
    </ModulePage>
  )
}
