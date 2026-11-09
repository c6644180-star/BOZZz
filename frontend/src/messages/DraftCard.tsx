import { useState } from 'react'
import { Check, Copy, Languages, Loader2, PenLine, Save, ShieldOff, Trash2 } from 'lucide-react'
import { placeholderPattern, stripPlaceholders, type BciDraft } from '../services/bci'
import { pushToast } from '../services/toast'

const LANGUAGES = ['English', 'Tamil', 'Tanglish', 'Hindi']

interface DraftCardProps {
  draft: BciDraft
  busy: boolean
  onSave: (id: string, text: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRewrite: (id: string) => Promise<void>
  onTranslate: (id: string, language: string) => Promise<void>
}

export function DraftCard({ draft, busy, onSave, onDelete, onRewrite, onTranslate }: DraftCardProps) {
  const [text, setText] = useState(draft.text)
  const [language, setLanguage] = useState(LANGUAGES[1])
  const [copied, setCopied] = useState(false)
  const placeholders = placeholderPattern(text)
  const dirty = text.trim() !== draft.text

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
      pushToast('success', 'Draft copied', 'Paste it yourself in the app you choose. BOZZ has not sent anything.')
    } catch {
      pushToast('error', 'Clipboard blocked', 'Select the draft text and copy it manually.')
    }
  }

  return (
    <article className="bci-draft" aria-label="Draft reply">
      <header className="bci-draft-head">
        <span className="bci-draft-badge"><ShieldOff /> Draft only, not sent</span>
        <span className="bci-draft-meta">{draft.language} · {draft.tone} · edited {formatDraftTime(draft.updated_at)}</span>
      </header>
      <textarea
        className="bci-draft-text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={Math.min(12, Math.max(4, text.split('\n').length + 2))}
        aria-label="Draft reply text"
        spellCheck
      />
      {placeholders.length > 0 && (
        <div className="bci-placeholder-block" role="status">
          <strong>{placeholders.length} [CONFIRM] placeholder{placeholders.length === 1 ? '' : 's'}</strong>
          <ul>
            {placeholders.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>Replace each placeholder with a real detail, or dismiss them to remove the markers. Copy stays blocked until then.</p>
          <button
            type="button"
            className="ghost-action"
            onClick={() => {
              const cleaned = stripPlaceholders(text)
              setText(cleaned)
              void onSave(draft.id, cleaned)
            }}
            disabled={busy || !stripPlaceholders(text)}
          >
            Remove placeholders and save
          </button>
        </div>
      )}
      <div className="bci-draft-actions">
        <button type="button" className="secondary-action" onClick={() => void copy()} disabled={placeholders.length > 0}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy draft'}
        </button>
        <button
          type="button"
          className="ghost-action"
          onClick={() => void onSave(draft.id, text)}
          disabled={busy || !dirty || !text.trim()}
        >
          {busy ? <Loader2 /> : <Save />} Save edit
        </button>
        <button type="button" className="ghost-action" onClick={() => void onRewrite(draft.id)} disabled={busy}>
          {busy ? <Loader2 /> : <PenLine />} Rewrite
        </button>
        <span className="bci-translate">
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            aria-label="Translate draft into"
            disabled={busy}
          >
            {LANGUAGES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button type="button" className="ghost-action" onClick={() => void onTranslate(draft.id, language)} disabled={busy}>
            {busy ? <Loader2 /> : <Languages />} Translate
          </button>
        </span>
        <button
          type="button"
          className="icon-action is-danger"
          onClick={() => void onDelete(draft.id)}
          disabled={busy}
          aria-label="Delete this draft"
          title="Delete this draft"
        >
          <Trash2 />
        </button>
      </div>
      <p className="bci-draft-note">
        BOZZ can copy this draft to your clipboard. It cannot send it: there is no send endpoint, SMTP or messaging API.
      </p>
    </article>
  )
}

function formatDraftTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
