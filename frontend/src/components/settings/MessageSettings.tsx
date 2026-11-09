import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Save, ShieldCheck, ShieldOff, Sparkles } from 'lucide-react'
import { useModules } from '../../hooks/useModules'
import { pushToast } from '../../services/toast'
import {
  confirmBciProvider,
  fetchBciProvider,
  fetchBciSettings,
  fetchBciStyle,
  saveBciSettings,
  saveBciStyle,
  type BciProviderInfo,
  type BciStyle,
} from '../../services/bci'

type StyleForm = Omit<BciStyle, 'updated_at' | 'expressions'>

const DEFAULT_STYLE: StyleForm = {
  language: 'English',
  formality: 'neutral',
  length: 'medium',
  tone: 'neutral',
}

const FORMALITY = ['casual', 'neutral', 'formal'] as const
const LENGTH = ['short', 'medium', 'long'] as const
const TONE = ['friendly', 'neutral', 'direct', 'warm', 'professional'] as const

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The local Messages request failed.'
}

export function MessageSettings() {
  const { snapshot, setPermission, busy } = useModules()
  const module = snapshot.modules.find((item) => item.id === 'bci')
  const granted = module?.permissions.find((item) => item.id === 'message_data')?.granted === true

  const [provider, setProvider] = useState<BciProviderInfo | null>(null)
  const [retention, setRetention] = useState(30)
  const [options, setOptions] = useState<number[]>([0, 7, 30, 90])
  const [style, setStyle] = useState<StyleForm>(DEFAULT_STYLE)
  const [expressions, setExpressions] = useState('')
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void fetchBciProvider().then(
      (info) => {
        if (alive) setProvider(info)
      },
      (caught: unknown) => {
        if (alive) setError(errorText(caught))
      },
    )
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!granted) return
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void Promise.all([fetchBciSettings(), fetchBciStyle()]).then(
      ([settings, stored]) => {
        if (!alive) return
        setRetention(settings.retention_days)
        setOptions(settings.options)
        setStyle({
          language: stored.language,
          formality: stored.formality,
          length: stored.length,
          tone: stored.tone,
        })
        setExpressions(stored.expressions.join(', '))
        setError(null)
        setLoading(false)
      },
      (caught: unknown) => {
        if (!alive) return
        setError(errorText(caught))
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [granted])

  async function grant() {
    const ok = await setPermission('bci', 'message_data', true)
    if (ok) pushToast('success', 'Message access granted', 'BCI can read local conversations. Nothing is sent.')
  }

  async function revoke() {
    const ok = await setPermission('bci', 'message_data', false)
    if (ok) pushToast('warning', 'Message access revoked', 'Every Messages request is blocked until you grant it again.')
  }

  async function changeRetention(days: number) {
    setWorking(true)
    try {
      const next = await saveBciSettings(days)
      setRetention(next.retention_days)
      setOptions(next.options)
      pushToast('success', 'Retention updated', 'It applies to new conversations and the cleanup job enforces it.')
    } catch (caught) {
      pushToast('error', 'Could not save retention', errorText(caught))
    } finally {
      setWorking(false)
    }
  }

  async function saveStyle() {
    setWorking(true)
    try {
      const saved = await saveBciStyle({
        ...style,
        expressions: expressions
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12),
      })
      setExpressions(saved.expressions.join(', '))
      pushToast('success', 'Style profile saved', 'It is used the next time BCI drafts or rewrites a reply.')
    } catch (caught) {
      pushToast('error', 'Could not save the style profile', errorText(caught))
    } finally {
      setWorking(false)
    }
  }

  async function confirmProvider() {
    if (!provider) return
    setWorking(true)
    try {
      const next = await confirmBciProvider(provider.provider)
      setProvider(next)
      pushToast('success', 'Provider confirmed', `${next.provider}/${next.model} is accepted for BCI AI actions you start.`)
    } catch (caught) {
      pushToast('error', 'Confirmation failed', errorText(caught))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section id="message-settings" className="settings-message-access" aria-label="Messages">
      <div className="settings-file-access__head">
        <h3>{granted ? <ShieldCheck /> : <ShieldOff />} Messages</h3>
        <span className={granted ? 'permission-enforcement enforced' : 'permission-enforcement'}>
          {granted ? 'Server-enforced' : 'Off'}
        </span>
      </div>
      <p>
        BCI stores conversations only in the local SQLite database. It can summarise, find unanswered questions and
        draft replies; there is no send endpoint, no SMTP and no messaging API. Drafts are always labelled “Draft only,
        not sent”.
      </p>

      {provider && (
        <p className="message-provider-row">
          <strong>AI provider:</strong> {provider.provider}/{provider.model} ·{' '}
          {provider.local ? 'runs locally' : 'remote — conversation text is sent only when you start an action'} ·{' '}
          {provider.available ? 'available' : `unavailable${provider.detail ? ` (${provider.detail})` : ''}`}
        </p>
      )}

      {!granted ? (
        <div className="file-access-gate">
          <p>
            Message data is off by default. Grant it here or in{' '}
            <a href="#module-permissions">Module permissions</a>. Every grant is audited.
          </p>
          <button type="button" className="primary-action" onClick={() => void grant()} disabled={busy !== null}>
            {busy ? <Loader2 /> : <ShieldCheck />} Grant message data access
          </button>
        </div>
      ) : provider?.requires_confirmation ? (
        <div className="message-provider-confirm" role="status">
          <p>
            <AlertTriangle /> This provider is remote and has not been confirmed. AI actions are refused until you
            confirm it once.
          </p>
          <button type="button" className="primary-action" onClick={() => void confirmProvider()} disabled={working}>
            {working ? <Loader2 /> : <ShieldCheck />} Confirm {provider.provider}
          </button>
        </div>
      ) : null}

      {granted && (
        <>
          <div className="message-settings-grid">
            <label className="message-retention">
              <span>Keep conversations</span>
              <select
                value={retention}
                onChange={(event) => void changeRetention(Number(event.target.value))}
                disabled={working || loading}
              >
                {options.map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? 'Until I delete them' : `${days} days`}
                  </option>
                ))}
              </select>
              <small>
                The backend cleanup job removes expired conversations at startup and periodically after that. A
                conversation can override this below its title.
              </small>
            </label>

            <div className="message-style">
              <h4><Sparkles /> Draft style</h4>
              {loading ? (
                <p className="file-access-status" role="status"><Loader2 /> Loading the style profile…</p>
              ) : (
                <>
                  <label>
                    <span>Language</span>
                    <input
                      value={style.language}
                      onChange={(event) => setStyle({ ...style, language: event.target.value })}
                      maxLength={40}
                      placeholder="English"
                    />
                  </label>
                  <div className="message-style-row">
                    <label>
                      <span>Formality</span>
                      <select
                        value={style.formality}
                        onChange={(event) => setStyle({ ...style, formality: event.target.value as StyleForm['formality'] })}
                      >
                        {FORMALITY.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Length</span>
                      <select
                        value={style.length}
                        onChange={(event) => setStyle({ ...style, length: event.target.value as StyleForm['length'] })}
                      >
                        {LENGTH.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Tone</span>
                      <select
                        value={style.tone}
                        onChange={(event) => setStyle({ ...style, tone: event.target.value as StyleForm['tone'] })}
                      >
                        {TONE.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                  </div>
                  <label>
                    <span>Expressions to reuse</span>
                    <input
                      value={expressions}
                      onChange={(event) => setExpressions(event.target.value)}
                      placeholder="e.g. sounds good, let me check"
                      maxLength={400}
                    />
                    <small>Comma-separated, up to 12 short phrases. Leave empty to use your usual wording.</small>
                  </label>
                  <button type="button" className="secondary-action" onClick={() => void saveStyle()} disabled={working}>
                    {working ? <Loader2 /> : <Save />} Save style profile
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="file-access-actions">
            <button type="button" className="ghost-action" onClick={() => void revoke()} disabled={busy !== null}>
              <ShieldOff /> Turn message data off
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
        Nothing is uploaded, scraped or sent. Deleting a conversation here or on the Messages page removes it from the
        local database only.
      </p>
    </section>
  )
}
