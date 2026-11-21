import { useEffect, useState } from 'react'
import { probeBackend } from '../services/backend'
import { pushToast } from '../services/toast'
import { ModulePage } from '../components/layout/ModulePage'
import { identityApiPaths } from '../services/identityApiPaths'

export default function IdentityManagerPage() {
  const [backend, setBackend] = useState<'online' | 'checking' | 'offline'>('checking')
  const [identities, setIdentities] = useState<
    Array<{
      id: string
      name: string
      description: string
      personality: object
      role: string
      greeting: string
      voice: object
      appearance: object
      behaviour: object
      associated_projects: string[]
      approved_tools: string[]
      memory_ownership: object
      creation_timestamp: string
      updated_timestamp: string
      status: string
      schema_version: number
    }>)([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [newIdentity, setNewIdentity] = useState<{
    name: string
    description: string
    personality: object
    role: string
    greeting: string
    voice: object
    appearance: object
    behaviour: object
  }>({
    name: "",
    description: "",
    personality: {},
    role: "assistant",
    greeting: "Hello!",
    voice: {},
    appearance: {},
    behaviour: {},
  })
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    let alive = true
    void probeBackend().then((s) => {
      if (alive) setBackend(s)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (backend !== 'online') return
    fetchIdentities()
  }, [backend])

  const fetchIdentities = async () => {
    try {
      const response = await fetch(`/api/identities`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to load identities')
      const data = await response.json()
      setIdentities(data.identities)
    } catch (err) {
      console.error('Failed to fetch identities:', err)
      pushToast('error', 'Failed to load identities', String(err))
    }
  }

  const handleCreate = async () => {
    try {
      const response = await fetch(`/api/identities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newIdentity.name,
          description: newIdentity.description,
          personality_config: newIdentity.personality,
          role: newIdentity.role,
          greeting: newIdentity.greeting,
          voice_configuration: newIdentity.voice,
          appearance_configuration: newIdentity.appearance,
          behaviour_configuration: newIdentity.behaviour,
        }),
      })
      if (!response.ok) throw new Error('Failed to create identity')
      const data = await response.json()
      fetchIdentities()
      setShowCreate(false)
      setNewIdentity({
        name: "",
        description: "",
        personality: {},
        role: "assistant",
        greeting: "Hello!",
        voice: {},
        appearance: {},
        behaviour: {},
      })
      pushToast('success', 'Identity created', `Identity "${data.id}" created successfully.`)
    } catch (err) {
      console.error('Failed to create identity:', err)
      pushToast('error', 'Failed to create identity', String(err))
    }
  }

  const handleRename = async (id: string, newName: string) => {
    try {
      const response = await fetch(`/api/identities/${id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: newName }),
      })
      if (!response.ok) throw new Error('Failed to rename identity')
      const data = await response.json()
      fetchIdentities()
      pushToast('success', 'Identity renamed', `Identity renamed to "${data.name}".`)
    } catch (err) {
      console.error('Failed to rename identity:', err)
      pushToast('error', 'Failed to rename identity', String(err))
    }
  }

  const handleEdit = async (id: string, field: string, value: string | object) => {
    try {
      let body = {}
      if (typeof value === 'object') {
        body = { [field]: JSON.stringify(value) }
      } else {
        body = { [field]: value }
      }
      const response = await fetch(`/api/identities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('Failed to edit identity')
      const data = await response.json()
      fetchIdentities()
      setEditing(null)
      setEditingField(null)
      pushToast('success', 'Identity updated', `Identity "${data.name}" updated.`)
    } catch (err) {
      console.error('Failed to edit identity:', err)
      pushToast('error', 'Failed to edit identity', String(err))
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Are you sure you want to delete identity "${id}"?`)) return
    try {
      const response = await fetch(`/api/identities/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to delete identity')
      const data = await response.json()
      fetchIdentities()
      setDeleting(null)
      pushToast('success', 'Identity deleted', `Identity "${id}" deleted.`)
    } catch (err) {
      console.error('Failed to delete identity:', err)
      pushToast('error', 'Failed to delete identity', String(err))
    }
  }

  const handleSwitch = async (id: string) => {
    try {
      const response = await fetch(`/api/identities/${id}/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to switch identity')
      const data = await response.json()
      pushToast('success', 'Identity switched', `Active identity switched to "${data.name}".`)
    } catch (err) {
      console.error('Failed to switch identity:', err)
      pushToast('error', 'Failed to switch identity', String(err))
    }
  }

  const handleArchive = async (id: string) => {
    try {
      const response = await fetch(`/api/identities/${id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to archive identity')
      const data = await response.json()
      fetchIdentities()
      pushToast('success', 'Identity archived', `Identity "${data.name}" archived.`)
    } catch (err) {
      console.error('Failed to archive identity:', err)
      pushToast('error', 'Failed to archive identity', String(err))
    }
  }

  return (
    <ModulePage
      title="AI Identities"
      subtitle="Create, manage, and switch between multiple AI identities. Each identity has independent personality, role, voice, and appearance configuration."
      tone="live"
    >
      <div className="identity-manager">
        {/* Backend status */}
        <div className="backend-status">
          <span>Backend: {backend}</span>
        </div>

        {/* Create identity panel */}
        {showCreate && (
          <div className="create-panel">
            <h3>Create New Identity</h3>
            <div className="form-row">
              <label>Name</label>
              <input
                value={newIdentity.name}
                onChange={(e) =>
                  setNewIdentity((prev) => ({ ...prev, name: e.target.value }))
                }
                minlength={1}
                maxLength={80}
                required
              />
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea
                value={newIdentity.description}
                onChange={(e) =>
                  setNewIdentity((prev) => ({ ...prev, description: e.target.value }))
                }
                maxLength={200}
                rows={2}
              ></textarea>
            </div>
            <div className="form-row">
              <label>Role</label>
              <input
                value={newIdentity.role}
                onChange={(e) =>
                  setNewIdentity((prev) => ({ ...prev, role: e.target.value }))
                }
                placeholder="assistant"
                maxLength={40}
              />
            </div>
            <div className="form-row">
              <label>Greeting</label>
              <input
                value={newIdentity.greeting}
                onChange={(e) =>
                  setNewIdentity((prev) => ({ ...prev, greeting: e.target.value }))
                }
                placeholder="Hello!"
                maxLength={100}
              />
            </div>
            <div className="form-row">
              <label>Personality</label>
              <textarea
                value={JSON.stringify(newIdentity.personality, null, 2)}
                onChange={(e) =>
                  setNewIdentity((prev) => ({
                    ...prev,
                    personality: JSON.parse(e.target.value),
                  }))
                }
                rows={3}
                placeholder='{"traits": ["helpful", "creative"], "style": "conversational"}'
              ></textarea>
            </div>
            <div className="form-row">
              <label>Voice</label>
              <textarea
                value={JSON.stringify(newIdentity.voice, null, 2)}
                onChange={(e) =>
                  setNewIdentity((prev) => ({
                    ...prev,
                    voice: JSON.parse(e.target.value),
                  }))
                }
                rows={3}
                placeholder='{"preferred_gender": "neutral", "speed": 1.0}'
              ></textarea>
            </div>
            <div className="form-row">
              <label>Appearance</label>
              <textarea
                value={JSON.stringify(newIdentity.appearance, null, 2)}
                onChange={(e) =>
                  setNewIdentity((prev) => ({
                    ...prev,
                    appearance: JSON.parse(e.target.value),
                  }))
                }
                rows={3}
                placeholder='{"theme": "dark", "style": "minimalist"}'
              ></textarea>
            </div>
            <div className="form-row">
              <label>Behaviour</label>
              <textarea
                value={JSON.stringify(newIdentity.behaviour, null, 2)}
                onChange={(e) =>
                  setNewIdentity((prev) => ({
                    ...prev,
                    behaviour: JSON.parse(e.target.value),
                  }))
                }
                rows={3}
                placeholder='{"response_length": "medium", "format": "markdown"}'
              ></textarea>
            </div>
            <button
              className="primary-button"
              onClick={handleCreate}
              disabled={backend !== "online"}
            >
              Create Identity
            </button>
            <button
              className="secondary-button"
              onClick={() => setShowCreate(false)}
              disabled={backend !== "online"}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Identity list */}
        <div className="identity-list">
          <h2>My Identities</h2>
          {identities.length === 0 && (
            <p className="empty-state">
              No identities yet. <button onClick={() => setShowCreate(true)}>Create your first identity</button>
            </p>
          )}
          <ul>
            {identities.map((id) => (
              <li key={id.id} className="identity-item">
                <div className="identity-header">
                  <span className="identity-name">{id.name}</span>
                  <span className="identity-status {id.status}">{id.status}</span>
                </div>
                <div className="identity-actions">
                  <button
                    className="action-button small"
                    onClick={() => handleSwitch(id.id)}
                    title="Switch to this identity"
                  >
                    Switch
                  </button>
                  <button
                    className="action-button small"
                    onClick={() => setEditing(id.id)}
                    title="Edit identity"
                  >
                    Edit
                  </button>
                  <button
                    className="action-button small danger"
                    onClick={() => setDeleting(id.id)}
                    title="Delete identity"
                  >
                    Delete
                  </button>
                  <button
                    className="action-button small"
                    onClick={() => setEditing(id.id)}
                    title="Rename identity"
                  >
                    Rename
                  </button>
                </div>
                <div className="identity-details">
                  <p><strong>Role:</strong> {id.role}</p>
                  <p><strong>Greeting:</strong> {id.greeting}</p>
                  <p><strong>Memory:</strong> {"private" in id.memory_ownership ? "Private" : "Shareable"}</p>
                  <p><strong>Projects:</strong>{' '}
                    {id.associated_projects.length > 0
                      ? id.associated_projects.join(", ")
                      : "None"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Rename modal */}
        {editing && (
          <div className="rename-modal">
            <h3>Rename Identity</h3>
            <input
              ref={(el) => el && setEditingField(el as HTMLInputElement)}
              value={editing ? /* Would need access to the identity name */ '' : ''}
              onChange={(e) => /* handled in rename */}
              defaultValue={/* identity name */}
            />
            <button className="primary-button" onClick={() => handleRename(editing, '')}>
              Rename
            </button>
            <button className="secondary-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        )}

        {/* Delete confirmation }}
        {deleting && (
          <div className="delete-confirmation">
            <p>Are you sure you want to delete identity <strong>{deleting}</strong>?</p>
            <button className="primary-button" onClick={() => handleDelete(deleting)}>
              Delete
            </button>
            <button className="secondary-button" onClick={() => setDeleting(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </ModulePage>
  )
}