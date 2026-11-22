import { useEffect, useState } from 'react'
import { ModulePage } from '../components/layout/ModulePage'
import { probeBackend } from '../services/backend'
import { pushToast } from '../services/toast'

type Identity = {
  id: string
  name: string
  description: string
  personality: Record<string, unknown>
  role: string
  greeting: string
  voice: Record<string, unknown>
  appearance: Record<string, unknown>
  behaviour: Record<string, unknown>
  associated_projects: string[]
  approved_tools: string[]
  memory_ownership: Record<string, unknown>
  creation_timestamp: string
  updated_timestamp: string
  status: string
  schema_version: number
}

const emptyIdentity = {
  name: '',
  description: '',
  role: 'assistant',
  greeting: 'Hello!',
  personality_config: {},
  voice_configuration: {},
  appearance_configuration: {},
  behaviour_configuration: {},
}

export default function IdentityManagerPage() {
  const [backend, setBackend] = useState<'online' | 'checking' | 'offline'>('checking')
  const [identities, setIdentities] = useState<Identity[]>([])
  const [activeIdentityId, setActiveIdentityId] = useState<string | null>(null)
  const [draft, setDraft] = useState(emptyIdentity)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadIdentities() {
    const [response, activeResponse] = await Promise.all([
      fetch('/api/identities'),
      fetch('/api/identities/active'),
    ])
    if (!response.ok) throw new Error('Could not load identities')
    if (!activeResponse.ok) throw new Error('Could not load the active identity')
    const data = await response.json() as { identities: Identity[] }
    const activeData = await activeResponse.json() as { identity: Identity | null }
    setIdentities(data.identities)
    setActiveIdentityId(activeData.identity?.id ?? null)
  }

  useEffect(() => {
    let active = true
    void probeBackend().then((state) => {
      if (!active) return
      setBackend(state)
      if (state === 'online') void loadIdentities().catch((error: unknown) =>
        pushToast('error', 'Identity loading failed', String(error)))
    })
    return () => { active = false }
  }, [])

  async function createIdentity() {
    if (!draft.name.trim()) {
      pushToast('error', 'Name required', 'Enter a name for this identity.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Create failed')
      await loadIdentities()
      setDraft(emptyIdentity)
      setShowCreate(false)
      pushToast('success', 'Identity created', 'The new identity is saved locally.')
    } catch (error) {
      pushToast('error', 'Identity creation failed', String(error))
    } finally {
      setBusy(false)
    }
  }

  async function runAction(id: string, action: 'switch' | 'archive' | 'delete') {
    if (action === 'delete' && !window.confirm('Permanently delete this identity?')) return
    setBusy(true)
    try {
      const response = await fetch(`/api/identities/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail ?? `${action} failed`)
      }
      await loadIdentities()
      window.dispatchEvent(new Event('bozz:identity-changed'))
      pushToast('success', `Identity ${action}ed`, `Identity action completed: ${action}.`)
    } catch (error) {
      pushToast('error', `Identity ${action} failed`, String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModulePage title="AI Identities" subtitle="Manage separate BOZZ personalities and configurations." tone="live">
      <section className="identity-manager">
        <p className="backend-status">Backend: {backend}</p>
        <button className="primary-button" disabled={backend !== 'online' || busy}
          onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Close form' : 'Create identity'}
        </button>
        {showCreate && (
          <div className="create-panel">
            <h3>New identity</h3>
            <label>Name<input value={draft.name} maxLength={80}
              onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} /></label>
            <label>Description<textarea value={draft.description} maxLength={200}
              onChange={(event) => setDraft((old) => ({ ...old, description: event.target.value }))} /></label>
            <label>Role<input value={draft.role} maxLength={40}
              onChange={(event) => setDraft((old) => ({ ...old, role: event.target.value }))} /></label>
            <label>Greeting<input value={draft.greeting} maxLength={100}
              onChange={(event) => setDraft((old) => ({ ...old, greeting: event.target.value }))} /></label>
            <button className="primary-button" disabled={busy} onClick={() => void createIdentity()}>Save identity</button>
          </div>
        )}
        <h2>My identities ({identities.length})</h2>
        {identities.length === 0 ? <p className="empty-state">No identities created yet.</p> : (
          <ul className="identity-list">
            {identities.map((identity) => (
              <li className="identity-item" key={identity.id}>
                <div className="identity-header">
                  <strong>{identity.name}</strong><span>{identity.id === activeIdentityId ? 'Active · ' : ''}{identity.status}</span>
                </div>
                <p>{identity.description || 'No description'}</p>
                <p>Role: {identity.role} · Greeting: {identity.greeting}</p>
                <div className="identity-actions">
                  <button disabled={busy || identity.status !== 'active' || identity.id === activeIdentityId} onClick={() => void runAction(identity.id, 'switch')}>Switch</button>
                  <button disabled={busy || identity.status !== 'active'} onClick={() => void runAction(identity.id, 'archive')}>Archive</button>
                  <button disabled={busy} onClick={() => void runAction(identity.id, 'delete')}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ModulePage>
  )
}
