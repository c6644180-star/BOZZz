import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, FileText, Loader2, ShieldOff, Upload, X } from 'lucide-react'
import {
  importConversation,
  previewImport,
  sourceLabel,
  type BciConversation,
  type BciImportPreview,
} from '../services/bci'
import { pushToast } from '../services/toast'
import { formatCount, formatWhen, truncate } from './format'

const MAX_FILE_BYTES = 2_000_000

export function ImportDialog({
  open,
  initialMode = 'file',
  onClose,
  onImported,
}: {
  open: boolean
  initialMode?: 'file' | 'paste'
  onClose: () => void
  onImported: (conversation: BciConversation) => void
}) {
  const [mode, setMode] = useState<'file' | 'paste'>(initialMode)
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('pasted-chat.txt')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BciImportPreview | null>(null)
  const [previewSource, setPreviewSource] = useState<{ name: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, busy, onClose])

  if (!open) return null

  function reset() {
    setPreview(null)
    setPreviewSource(null)
    setError(null)
    setFile(null)
    setPasted('')
  }

  async function readFile(selected: File | null) {
    if (!selected) return
    if (selected.size > MAX_FILE_BYTES) {
      setError('This file is larger than 2 MB. Split it before importing.')
      return
    }
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const content = await selected.text()
      const result = await previewImport(selected.name, content)
      setFile(selected)
      setPreview(result.preview)
      setPreviewSource({ name: selected.name, content })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This file could not be read.')
    } finally {
      setBusy(false)
    }
  }

  async function previewPaste(event: FormEvent) {
    event.preventDefault()
    const content = pasted.trim()
    if (!content) return
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const result = await previewImport(pastedName.trim() || 'pasted-chat.txt', content)
      setPreview(result.preview)
      setPreviewSource({ name: pastedName.trim() || 'pasted-chat.txt', content })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This text could not be read.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (!previewSource) return
    setBusy(true)
    setError(null)
    try {
      const result = await importConversation(previewSource.name, previewSource.content)
      pushToast('success', 'Conversation stored locally', `${formatCount(result.conversation.messages_count)} message(s) are in the local database. No message was sent.`)
      onImported(result.conversation)
      reset()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bci-modal-layer" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="bci-modal bci-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bci-import-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="bci-modal-head">
          <div>
            <h2 id="bci-import-title"><Upload /> Import a conversation</h2>
            <p>Parsed locally from a file you choose. BOZZ does not connect to WhatsApp, Telegram, Instagram or any app.</p>
          </div>
          <button type="button" className="icon-action" onClick={onClose} disabled={busy} aria-label="Close import dialog">
            <X />
          </button>
        </header>

        <div className="bci-import-tabs" role="tablist" aria-label="Import source">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'file'}
            className={mode === 'file' ? 'is-active' : ''}
            onClick={() => { setMode('file'); reset() }}
          >
            <FileText /> File
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'paste'}
            className={mode === 'paste' ? 'is-active' : ''}
            onClick={() => { setMode('paste'); reset() }}
          >
            <Upload /> Paste text
          </button>
        </div>

        {mode === 'file' ? (
          <label className="bci-dropzone">
            <input
              type="file"
              accept=".txt,.text,.chat,.log,.json,text/plain,application/json"
              onChange={(event) => void readFile(event.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <FileText aria-hidden="true" />
            <strong>{file ? file.name : 'Choose a .txt or .json chat export'}</strong>
            <span>WhatsApp “Export chat” text files, plain text and JSON up to 2 MB. Nothing is uploaded.</span>
          </label>
        ) : (
          <form className="bci-paste" onSubmit={(event) => void previewPaste(event)}>
            <label>
              File name
              <input
                value={pastedName}
                onChange={(event) => setPastedName(event.target.value)}
                maxLength={255}
                spellCheck={false}
              />
            </label>
            <label>
              Chat text
              <textarea
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                rows={8}
                maxLength={2_000_000}
                placeholder={'Alice: Can you send the quote?\nMe: I will check today.'}
                aria-label="Paste chat text"
              />
            </label>
            <button type="submit" className="secondary-action" disabled={busy || !pasted.trim()}>
              {busy ? <Loader2 /> : <FileText />} Preview
            </button>
          </form>
        )}

        {busy && !preview && <p className="bci-import-status" role="status"><Loader2 /> Parsing locally…</p>}
        {error && <p className="bci-import-error" role="alert"><AlertTriangle /> {error}</p>}

        {preview && (
          <section className="bci-import-preview" aria-label="Import preview">
            <div className="bci-preview-stats">
              <span><strong>{formatCount(preview.message_count)}</strong> messages</span>
              <span><strong>{formatCount(preview.char_count)}</strong> characters</span>
              <span><strong>{preview.inbound_count}</strong> inbound</span>
              <span><strong>{preview.outbound_count}</strong> outbound</span>
              <span className="bci-source-chip is-format">{sourceLabel(preview.source)}</span>
            </div>
            <p className="bci-preview-range">
              {preview.first_at || preview.last_at
                ? `${formatWhen(preview.first_at)} → ${formatWhen(preview.last_at)}`
                : 'No timestamps in this file.'}
            </p>
            {preview.warnings.map((warning) => (
              <p key={warning} className="bci-import-warning"><AlertTriangle /> {warning}</p>
            ))}
            <ol className="bci-preview-messages">
              {preview.messages.slice(0, 8).map((message, index) => (
                <li key={`${message.sender}-${index}`}>
                  <strong>{message.sender}</strong>
                  <span>{truncate(message.text, 180)}</span>
                </li>
              ))}
            </ol>
            {preview.truncated && <p className="bci-preview-more">Preview shows the first 8 of {formatCount(preview.message_count)} messages.</p>}
            <p className="bci-import-limit">
              Limits: {formatCount(2_000)} messages and {formatCount(20_000)} characters per conversation.
            </p>
          </section>
        )}

        <footer className="bci-modal-actions">
          <p><ShieldOff /> Import stores text in the local SQLite database only. It never sends a message.</p>
          <div>
            <button type="button" className="ghost-action" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="primary-action" onClick={() => void confirmImport()} disabled={busy || !preview}>
              {busy ? <Loader2 /> : <Upload />} Import locally
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
