import { useState } from 'react'
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw, ShieldOff, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { stripPlaceholders } from '../services/bci'
import { pushToast } from '../services/toast'
import { actionLabel, reasonLabel } from './format'
import type { ActionEnvelope } from './types'

export function ActionResultCard({
  envelope,
  busy,
  onRegenerate,
}: {
  envelope: ActionEnvelope
  busy: boolean
  onRegenerate: (envelope: ActionEnvelope) => void
}) {
  const { response, action } = envelope
  const result = response.result
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!result) {
    return (
      <article className="bci-result is-failed" role="alert">
        <header>
          <span className="bci-result-title"><AlertTriangle /> {actionLabel(action)} failed</span>
          <span className="bci-result-task">Intent {response.id.slice(0, 8)}</span>
        </header>
        <p>{response.message}</p>
        {response.errors.map((error) => <p key={`${error.stage}-${error.detail}`} className="bci-result-error">{error.stage}: {error.detail}</p>)}
        <div className="bci-result-actions">
          <button type="button" className="ghost-action" onClick={() => onRegenerate(envelope)} disabled={busy}>
            {busy ? <Loader2 /> : <RefreshCw />} Try again
          </button>
          <Link className="ghost-action" to={`/intent-map?intent=${encodeURIComponent(response.id)}`}>
            <ExternalLink /> Open Intent Map task
          </Link>
        </div>
      </article>
    )
  }

  const placeholders = result.placeholders
  const visibleText = dismissed ? stripPlaceholders(result.text) : result.text
  const evidence = response.verification_evidence[0]?.detail

  async function copy() {
    try {
      await navigator.clipboard.writeText(visibleText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
      pushToast('success', 'Copied', 'Paste it yourself where you want. BOZZ has not sent anything.')
    } catch {
      pushToast('error', 'Clipboard blocked', 'Select the text and copy it manually.')
    }
  }

  return (
    <article className={`bci-result bci-result-${action}`} aria-label={`${actionLabel(action)} result`}>
      <header>
        <span className="bci-result-title"><Sparkles /> {actionLabel(action)}</span>
        <span className="bci-result-task">
          {result.provider === 'local' ? 'Local rules' : `${result.provider}/${result.model}`} ·{' '}
          {result.messages_used} of {result.message_count} message(s)
        </span>
      </header>

      <pre className="bci-result-text">{visibleText}</pre>

      {placeholders.length > 0 && (
        <div className={dismissed ? 'bci-placeholder-block is-dismissed' : 'bci-placeholder-block'} role="status">
          <strong>{placeholders.length} [CONFIRM] placeholder{placeholders.length === 1 ? '' : 's'}</strong>
          {!dismissed ? (
            <>
              <ul>{placeholders.map((item) => <li key={item}>{item}</li>)}</ul>
              <p>Copy is blocked until every placeholder is filled or dismissed.</p>
              <button type="button" className="ghost-action" onClick={() => setDismissed(true)}>
                <ShieldOff /> Dismiss placeholders
              </button>
            </>
          ) : (
            <p>Placeholders were dismissed and removed from the text below. Check the wording before pasting it anywhere.</p>
          )}
        </div>
      )}

      {result.items.length > 0 && (
        <ul className="bci-result-list" aria-label="Messages that need attention">
          {result.items.map((item) => (
            <li key={item.message_id}>
              <span><strong>{item.sender}</strong> · {item.reasons.map(reasonLabel).join(', ')}</span>
              <p>{item.excerpt}</p>
            </li>
          ))}
        </ul>
      )}

      {result.questions.length > 0 && (
        <ul className="bci-result-list" aria-label="Unanswered questions">
          {result.questions.map((item) => (
            <li key={item.message_id}>
              <span><strong>{item.sender}</strong> asked</span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      )}

      <footer className="bci-result-footer">
        {evidence && <p>{evidence}</p>}
        <div className="bci-result-actions">
          <button type="button" className="secondary-action" onClick={() => void copy()} disabled={placeholders.length > 0 && !dismissed}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy text'}
          </button>
          <button type="button" className="ghost-action" onClick={() => onRegenerate(envelope)} disabled={busy}>
            {busy ? <Loader2 /> : <RefreshCw />} Regenerate
          </button>
          <Link className="ghost-action" to={`/intent-map?intent=${encodeURIComponent(response.id)}`}>
            <ExternalLink /> Intent Map task
          </Link>
        </div>
        <p className="bci-result-note"><ShieldOff /> Nothing was sent. This build has no send endpoint.</p>
      </footer>
    </article>
  )
}
