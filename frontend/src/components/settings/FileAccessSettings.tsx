import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FolderMinus, FolderPlus, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { useModules } from '../../hooks/useModules'
import { pushToast } from '../../services/toast'
import { addRoot, listRoots, removeRoot, type FileRoot } from '../../services/files'

export function FileAccessSettings() {
  const { snapshot, setPermission, busy } = useModules()
  const module = snapshot.modules.find((item) => item.id === 'spatial-desktop')
  const holoModule = snapshot.modules.find((item) => item.id === 'holo-projects')
  const granted = module?.permissions.find((item) => item.id === 'file_access')?.granted === true
    || holoModule?.permissions.find((item) => item.id === 'file_access')?.granted === true
  const [roots, setRoots] = useState<FileRoot[]>([])
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await listRoots()
      setRoots(result.roots)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Allowed folders could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Load the allowed folders once; the result arrives in an async callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  async function grant() {
    const spatial = await setPermission('spatial-desktop', 'file_access', true)
    const holo = await setPermission('holo-projects', 'file_access', true)
    if (spatial || holo) {
      pushToast('success', 'File access granted', 'Spatial Desktop and Holographic Projects can now read folders you allow below.')
    }
    await refresh()
  }

  async function revoke() {
    const spatial = await setPermission('spatial-desktop', 'file_access', false)
    const holo = await setPermission('holo-projects', 'file_access', false)
    if (spatial || holo) {
      pushToast('warning', 'File access revoked', 'Folder reads are blocked for both workspaces until you grant it again.')
    }
    await refresh()
  }

  async function add() {
    const value = path.trim()
    if (!value) return
    setWorking(true)
    try {
      const result = await addRoot(value)
      setRoots(result.roots)
      setPath('')
      pushToast('success', 'Folder allowed', `${result.added.label} is readable by Spatial Desktop. Files are never changed.`)
    } catch (caught) {
      pushToast('error', 'Folder was not allowed', caught instanceof Error ? caught.message : undefined)
    } finally {
      setWorking(false)
    }
  }

  async function remove(target: string) {
    setWorking(true)
    try {
      const result = await removeRoot(target)
      setRoots(result.roots)
      pushToast('info', 'Folder access revoked', 'The folder is no longer readable by Spatial Desktop.')
    } catch (caught) {
      pushToast('error', 'Could not revoke the folder', caught instanceof Error ? caught.message : undefined)
    } finally {
      setWorking(false)
    }
  }

  return (
    <section id="file-access" className="settings-file-access" aria-label="File access">
      <div className="settings-file-access__head">
        <h3>{granted ? <ShieldCheck /> : <ShieldOff />} File access</h3>
        <span className={granted ? 'permission-enforcement enforced' : 'permission-enforcement'}>
          {granted ? 'Server-enforced' : 'Off'}
        </span>
      </div>
      <p>
        Spatial Desktop and Holographic Projects are read-only. They can list, search, preview and (with approval) ask
        the OS to open files inside the folders you allow here. They never delete, move, rename, write or upload a file.
      </p>

      {!granted ? (
        <div className="file-access-gate">
          <p>
            File access is off by default. Grant it in{' '}
            <a href="#module-permissions">Module permissions</a> or with this button. Every grant is audited.
          </p>
          <button type="button" className="primary-action" onClick={() => void grant()} disabled={busy !== null}>
            {busy ? <Loader2 /> : <ShieldCheck />} Grant file access for both workspaces
          </button>
        </div>
      ) : (
        <>
          <div className="file-access-row">
            <input
              type="text"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add()
              }}
              placeholder="C:\Users\You\Documents\TestFolder"
              aria-label="Absolute folder path to allow"
              spellCheck={false}
            />
            <button type="button" className="primary-action" onClick={() => void add()} disabled={working || !path.trim()}>
              {working ? <Loader2 /> : <FolderPlus />} Allow folder
            </button>
          </div>
          <p className="file-access-hint">
            Enter an absolute path. BOZZ resolves it with realpath and rejects drive roots, relative paths and anything
            outside the folder you name.
          </p>
          {loading ? (
            <p className="file-access-status" role="status"><Loader2 /> Loading allowed folders…</p>
          ) : roots.length === 0 ? (
            <p className="file-access-status">No folders are allowed yet. Nothing can be read until you add one.</p>
          ) : (
            <ul className="file-access-list">
              {roots.map((root) => (
                <li key={root.path}>
                  <span>
                    <strong>{root.label}</strong>
                    <small>{root.path}</small>
                  </span>
                  <button type="button" className="icon-action" onClick={() => void remove(root.path)} disabled={working} aria-label={`Revoke access to ${root.path}`}>
                    <FolderMinus />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="file-access-actions">
            <button type="button" className="ghost-action" onClick={() => void revoke()} disabled={busy !== null}>
              <ShieldOff /> Turn file access off
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="module-permission-banner is-error" role="alert">
          <AlertTriangle /> {error}
        </p>
      )}
      <p className="panel-note">
        Removing a folder only revokes read access. Dismissing a card only removes the card; the file is untouched.
      </p>
    </section>
  )
}
