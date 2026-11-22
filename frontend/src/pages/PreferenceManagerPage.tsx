import { useEffect, useState } from 'react'
import { ModulePage } from '../components/layout/ModulePage'
import { probeBackend } from '../services/backend'
import { pushToast } from '../services/toast'

type IdentityOption = { id: string; name: string }
type PreferenceProfile = {
  id: string
  name: string
  identity_id: string
  owner_id: string
  visual_preferences: Record<string, unknown>
  ai_behaviour_preferences: Record<string, unknown>
  productivity_preferences: Record<string, unknown>
  accessibility_preferences: Record<string, unknown>
  functional_preferences: Record<string, unknown>
  privacy_preferences: Record<string, unknown>
  project_specific_settings: Record<string, unknown>
  creation_timestamp: string
  updated_timestamp: string
  status: string
  schema_version: number
}

export default function PreferenceManagerPage() {
  const [backend, setBackend] = useState<'online' | 'checking' | 'offline'>('checking')
  const [profiles, setProfiles] = useState<PreferenceProfile[]>([])
  const [identities, setIdentities] = useState<IdentityOption[]>([])
  const [name, setName] = useState('Default')
  const [identityId, setIdentityId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadProfiles() {
    const response = await fetch('/api/preference-profiles')
    if (!response.ok) throw new Error('Could not load preference profiles')
    const data = await response.json() as { identities: PreferenceProfile[] }
    setProfiles(data.identities)
  }

  async function loadIdentities() {
    const response = await fetch('/api/identities')
    if (!response.ok) throw new Error('Could not load identities')
    const data = await response.json() as { identities: IdentityOption[] }
    setIdentities(data.identities)
    if (data.identities.length && !identityId) setIdentityId(data.identities[0].id)
  }

  useEffect(() => {
    let active = true
    void probeBackend().then(async (state) => {
      if (!active) return
      setBackend(state)
      if (state !== 'online') return
      try {
        await Promise.all([loadProfiles(), loadIdentities()])
      } catch (error) {
        pushToast('error', 'Preference data could not load', String(error))
      }
    })
    return () => { active = false }
  }, [])

  async function createProfile() {
    if (!name.trim() || !identityId) {
      pushToast('error', 'Missing information', 'Enter a profile name and create/select an identity first.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/preference-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          identity_id: identityId,
          visual_preferences: {},
          ai_behaviour_preferences: {},
          productivity_preferences: {},
          accessibility_preferences: {},
          functional_preferences: {},
          privacy_preferences: {},
          project_specific_settings: {},
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail ?? 'Profile creation failed')
      }
      await loadProfiles()
      setShowCreate(false)
      pushToast('success', 'Preference profile created', 'The profile is linked to the selected identity.')
    } catch (error) {
      pushToast('error', 'Could not create preference profile', String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModulePage title="Preference Management" subtitle="Create and view identity-linked preference profiles." tone="live">
      <section className="preference-manager">
        <p className="backend-status">Backend: {backend}</p>
        <button className="primary-button" disabled={backend !== 'online' || busy || identities.length === 0}
          onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Close form' : 'Create profile'}
        </button>
        {identities.length === 0 && backend === 'online' && (
          <p className="empty-state">Create an AI identity before creating a preference profile.</p>
        )}
        {showCreate && (
          <div className="create-panel">
            <h3>New preference profile</h3>
            <label>Profile name<input value={name} maxLength={80}
              onChange={(event) => setName(event.target.value)} /></label>
            <label>Linked identity
              <select value={identityId} onChange={(event) => setIdentityId(event.target.value)}>
                {identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}</option>)}
              </select>
            </label>
            <button className="primary-button" disabled={busy} onClick={() => void createProfile()}>Save profile</button>
          </div>
        )}
        <h2>My preference profiles ({profiles.length})</h2>
        {profiles.length === 0 ? <p className="empty-state">No preference profiles yet.</p> : (
          <ul className="profile-list">
            {profiles.map((profile) => (
              <li className="profile-item" key={profile.id}>
                <div className="profile-header"><strong>{profile.name}</strong><span>{profile.status}</span></div>
                <p>Identity: {identities.find((identity) => identity.id === profile.identity_id)?.name ?? profile.identity_id}</p>
                <p>Updated: {new Date(profile.updated_timestamp).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ModulePage>
  )
}
