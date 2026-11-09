import { AlertTriangle, CheckCircle2, CircleOff, Loader2, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useModules } from '../../hooks/useModules'
import { statusSlug } from '../../services/modules'
import type { ModuleInfo, PermissionId } from '../../types/modules'

export function ModulePermissions({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const { snapshot, loading, offline, error, busy, refresh, setPermission } = useModules()
  const full = variant === 'full'

  return (
    <div className={`module-permissions module-permissions--${variant}`}>
      <div className="module-permissions__head">
        <div>
          <h3><ShieldCheck /> Module permissions</h3>
          <p>
            Every permission starts off. Grants are stored by the local backend, audited, and mirrored in this browser.
          </p>
        </div>
        <button
          type="button"
          className="icon-action"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh module permissions"
          title="Refresh from the local backend"
        >
          <RefreshCw />
        </button>
      </div>

      {offline && (
        <p className="module-permission-banner" role="status">
          <AlertTriangle />
          Backend offline. Showing the last confirmed browser mirror. Permission changes need the local backend.
        </p>
      )}
      {error && !offline && (
        <p className="module-permission-banner is-error" role="alert">
          <AlertTriangle />
          {error}
        </p>
      )}

      {loading && (
        <p className="module-permission-loading" role="status">
          <Loader2 /> Loading permissions…
        </p>
      )}

      <div className="module-permission-list">
        {snapshot.modules.map((module) => (
          <ModulePermissionCard
            key={module.id}
            module={module}
            full={full}
            offline={offline}
            busy={busy}
            onPermission={(permissionId, granted) => void setPermission(module.id, permissionId, granted)}
          />
        ))}
      </div>

      <p className="module-permission-footnote">
        Server enforcement is active for file access (Intent Map and Spatial Desktop), message data (BCI), and HGI
        device control (every desktop action and the desktop WebSocket). Other permissions are recorded declarations
        for modules that are not connected yet; this build does not pretend they are enforced. Every grant, revoke and
        denial is appended to the local audit log.
      </p>
    </div>
  )
}

function ModulePermissionCard({
  module,
  full,
  offline,
  busy,
  onPermission,
}: {
  module: ModuleInfo
  full: boolean
  offline: boolean
  busy: string | null
  onPermission: (permissionId: PermissionId, granted: boolean) => void
}) {
  return (
    <article className={`module-permission-card status-${statusSlug(module.status)}`}>
      <header>
        <div>
          <strong>{module.name}</strong>
          <small>v{module.version}</small>
        </div>
        <span className={`module-status status-${statusSlug(module.status)}`}>
          {module.status === 'Not connected' ? <CircleOff /> : module.status === 'Ready' ? <CheckCircle2 /> : <AlertTriangle />}
          {module.status}
        </span>
      </header>

      <p className="module-permission-detail">{module.statusDetail}</p>

      {full && (
        <>
          <p className="module-permission-description">{module.description}</p>
          <ul className="module-capabilities">
            {module.capabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
          {module.errors.length > 0 && (
            <ul className="module-card-errors">
              {module.errors.map((item) => (
                <li key={item}><AlertTriangle />{item}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {module.permissions.length === 0 ? (
        <p className="module-no-permissions"><LockKeyhole /> No module permissions required.</p>
      ) : (
        <ul className="module-permission-toggles">
          {module.permissions.map((item) => {
            const key = `${module.id}:${item.id}`
            return (
              <li key={item.id}>
                <label>
                  <span>
                    {item.label}
                    <small>{item.scope}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={item.granted}
                    disabled={offline || busy !== null}
                    onChange={(event) => onPermission(item.id, event.target.checked)}
                  />
                </label>
                <span className={item.enforced ? 'permission-enforcement enforced' : 'permission-enforcement'}>
                  {busy === key ? <Loader2 /> : item.enforced ? 'Server-enforced' : 'Declared'}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {full && module.route && (
        <Link className="module-open-link" to={module.route}>
          Open {module.name}
        </Link>
      )}
    </article>
  )
}
