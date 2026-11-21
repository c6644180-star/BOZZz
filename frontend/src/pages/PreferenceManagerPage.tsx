import { useEffect, useState } from 'react'
import { probeBackend } from '../services/backend'
import { pushToast } from '../services/toast'
import { ModulePage } from '../components/layout/ModulePage'
import { useBozzVoice } from '../hooks/useBozzVoice'

export default function PreferenceManagerPage() {
  const { settings, updateSettings, tts, mic } = useBozzVoice()
  const [backend, setBackend] = useState<'online' | 'checking' | 'offline'>('checking')
  const [profiles, setProfiles] = useState<
    Array<{
      id: string
      name: string
      identity_id: string
      visual: object
      ai_behaviour: object
      productivity: object
      accessibility: object
      functional: object
      privacy: object
      project: object
      creation_timestamp: string
      updated_timestamp: string
      status: string
    }>)([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    let alive = true
    void probeBackend().then((s) => { if (alive) setBackend(s) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (backend !== 'online') return
    fetchProfiles()
  }, [backend])

  const fetchProfiles = async () => {
    try {
      const response = await fetch('/api/preference-profiles', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to load preference profiles')
      const data = await response.json()
      setProfiles(data.identities)
    } catch (err) {
      console.error('Failed to fetch preference profiles:', err)
      pushToast('error', 'Failed to load preference profiles', String(err))
    }
  }

  const handleCreate = async () => {
    try {
      const response = await fetch('/api/preference-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Default',
          identity_id: 'athena', // Would be dynamically determined
          visual_preferences: {},
          ai_behaviour_preferences: {},
          productivity_preferences: {},
          accessibility_preferences: {},
          functional_preferences: {},
          privacy_preferences: {},
          project_specific_settings: {},
        }),
      })
      if (!response.ok) throw new Error('Failed to create preference profile')
      const data = await response.json()
      fetchProfiles()
      setShowCreate(false)
      pushToast('success', 'Preference profile created', `Profile "${data.name}" created successfully.`)
    } catch (err) {
      console.error('Failed to create preference profile:', err)
      pushToast('error', 'Failed to create preference profile', String(err))
    }
  }

  const handleEdit = async (id: string, field: string, value: string | object) => {
    try let body = {}
    if (typeof value === 'object') {
      body = { [field]: JSON.stringify(value) }
    } else {
      body = { [field]: value }
    }
    const response = await fetch(`/api/preference-profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('Failed to edit preference profile')
    const data = await response.json()
    fetchProfiles()
    setEditing(null)
    setEditingField(null)
    pushToast('success', 'Preference profile updated', `Profile "${data.name}" updated.`)
    } catch (err) {
      console.error('Failed to edit preference profile:', err)
      pushToast('error', 'Failed to edit preference profile', String(err))
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Are you sure you want to delete preference profile "${id}"?`)) return
    try {
      const response = await fetch(`/api/preference-profiles/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to delete preference profile')
      const data = await response.json()
      fetchProfiles()
      setDeleting(null)
      pushToast('success', 'Preference profile deleted', `Profile "${id}" deleted.`)
    } catch (err) {
      console.error('Failed to delete preference profile:', err)
      pushToast('error', 'Failed to delete preference profile', String(err))
    }
  }

  const handleProposeChange = async (id: string, changes: object) => {
    try {
      const response = await fetch('/api/preference-profiles/' + id + '/propose-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      if (!response.ok) throw new Error('Failed to propose preference change')
      const data = await response.json()
      // Show the proposal in a modal/UI
      setStatus(`Change proposed: ${data.change_summary}`)
      pushToast('info', 'Preference change proposed', data.change_summary)
    } catch (err) {
      console.error('Failed to propose preference change:', err)
      pushToast('error', 'Failed to propose preference change', String(err))
    }
  }

  const handleApplyChange = async (id: string) => {
    try {
      const response = await fetch('/api/preference-profiles/' + id + '/apply-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to apply preference change')
      const data = await response.json()
      fetchProfiles()
      pushToast('success', 'Preference change applied', `Changes applied to "${data.name}".`)
    } catch (err) {
      console.error('Failed to apply preference change:', err)
      pushToast('error', 'Failed to apply preference change', String(err))
    }
  }

  const handleResetProfile = async (id: string) => {
    if (!window.confirm(`Are you sure you want to reset preference profile "${id}" to defaults?`)) return
    try {
      const response = await fetch('/api/preference-profiles/' + id + '/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to reset preference profile')
      const data = await response.json()
      fetchProfiles()
      pushToast('success', 'Preference profile reset', `Profile "${data.name}" reset to defaults.`)
    } catch (err) {
      console.error('Failed to reset preference profile:', err)
      pushToast('error', 'Failed to reset preference profile', String(err))
    }
  }

  return (
    <ModulePage
      title="Preference Management"
      subtitle="User and identity-specific preference profiles with safe change workflow"
      tone="live"
    >
      <div className="preference-manager">
        {/* Backend status */}
        <div className="backend-status">
          <span>Backend: {backend}</span>
        </div>

        {/* Create profile panel */}
        {showCreate && (
          <div className="create-panel">
            <h3>Create New Preference Profile</h3>
            <div className="form-row">
              <label>Name</label>
              <input
                value={/* would be from state */}
                onChange={(e) => /* handled */}
                minlength={1}
                maxLength={80}
                required
              />
            </div>
            <div className="form-row">
              <label>Identity (linked)</label>
              <input
                value={/* would be from identity manager */}
                onChange={(e) => /* handled */}
                minlength={1}
                maxLength={32}
                required
              />
            </div>
            <button
              className="primary-button"
              onClick={handleCreate}
              disabled={backend !== "online"}
            >
              Create Profile
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

        {/* Profile list */}
        <div className="profile-list">
          <h2>My Preference Profiles</h2>
          {profiles.length === 0 && (
            <p className="empty-state">
              No preference profiles yet. <button onClick={() => setShowCreate(true)}>Create your first profile</button>
            </p>
          )}
          <ul>
            {profiles.map((profile) => (
              <li key={profile.id} className="profile-item">
                <div className="profile-header">
                  <span className="profile-name">{profile.name}</span>
                  <span className="profile-status">{profile.status}</span>
                </div>
                <div className="profile-actions">
                  <button
                    className="action-button small"
                    onClick={() => handleProposeChange(profile.id, {})}
                    title="Propose preference changes"
                  >
                    Propose Changes
                  </button>
                  <button
                    className="action-button small"
                    onClick={() => /* open edit modal */}
                    title="Edit profile"
                  >
                    Edit
                  </button>
                  <button
                    className="action-button small danger"
                    onClick={() => setDeleting(profile.id)}
                    title="Delete profile"
                  >
                    Delete
                  </button>
                </div>
                <div className="profile-details">
                  <p><strong>Visual:</strong> {"private" in profile.visual ? "configured" : "default"}</p>
                  <p><strong>AI Behaviour:</strong> {"private" in profile.ai_behaviour ? "configured" : "default"}</p>
                  <p><strong>Productivity:</strong> {"private" in profile.productivity ? "configured" : "default"}</p>
                  <p><strong>Accessibility:</strong> {"private" in profile.accessibility ? "configured" : "default"}</p>
                  <p><strong>Functional:</strong> {"private" in profile.functional ? "configured" : "default"}</p>
                  <p><strong>Privacy:</strong> {"private" in profile.privacy ? "configured" : "default"}</p>
                  <p><strong>Project:</strong> {"private" in profile.project ? "configured" : "default"}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Delete confirmation */}
        {deleting && (
          <div className="delete-confirmation">
            <p>Are you sure you want to delete preference profile <strong>{deleting}</strong>?</p>
            <button className="primary-button" onClick={() => handleDelete(deleting)}>
              Delete
            </button>
            <button className="secondary-button" onClick={() => setDeleting(null)}>
              Cancel
            </button>
          </div>
        )}

        {/* Status banner */}
        {status && (
          <div className="status-banner">
            <span>{status}</span>
          </div>
        )}
      </div>
    </ModulePage>
  )
}