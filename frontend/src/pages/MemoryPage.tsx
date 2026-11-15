import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Download, Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'
import { useModules } from '../hooks/useModules'
import { pushToast } from '../services/toast'
import { loadNotes, onLocalStoreChange, saveNotes } from '../services/localStore'
import {
  MemoryError,
  addMemory,
  clearMemory,
  deleteMemory,
  exportMemory,
  fetchMemoryStatus,
  listMemory,
  setMemoryInChat,
  updateMemory,
  type MemoryFact,
  type MemoryStatus,
} from '../services/memoryApi'
import type { MemoryNote } from '../types/bozz'

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function MemoryPage() {
  const { setPermission } = useModules()
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [offline, setOffline] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [legacy, setLegacy] = useState<MemoryNote[]>(() => loadNotes())

  useEffect(() => onLocalStoreChange(() => setLegacy(loadNotes())), [])

  const reload = useCallback(async (search = '') => {
    try {
      const next = await fetchMemoryStatus()
      setStatus(next)
      setOffline(null)
      setFacts(next.permissionGranted ? await listMemory(search) : [])
    } catch (error) {
      setOffline(error instanceof Error ? error.message : 'Memory is unavailable.')
    }
  }, [])

  useEffect(() => {
    // Initial load; reload() only sets state after the awaited requests finish.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  async function run(action: () => Promise<unknown>, done?: string) {
    setMessage(null)
    try {
      await action()
      if (done) setMessage(done)
      await reload(query)
    } catch (error) {
      setMessage(error instanceof MemoryError || error instanceof Error ? error.message : 'That did not work.')
    }
  }

  async function grant() {
    const ok = await setPermission('memory', 'memory_data', true)
    if (ok) await reload(query)
    else setMessage('Could not turn on Memory data. Is the BOZZ backend running?')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    void run(async () => {
      await addMemory(value)
      setText('')
    }, 'Saved. BOZZ will only use it if you turn on "Use memory in chat".')
  }

  async function moveLegacy() {
    let moved = 0
    const keep: MemoryNote[] = []
    for (const note of legacy) {
      try {
        await addMemory(note.text, 'import')
        moved += 1
      } catch {
        keep.push(note) // refused (secret, duplicate, full): keep it here, never drop silently
      }
    }
    saveNotes(keep)
    setLegacy(keep)
    setMessage(`Moved ${moved} note${moved === 1 ? '' : 's'} into BOZZ memory.${keep.length ? ` ${keep.length} could not be moved and stay in this browser.` : ''}`)
    await reload(query)
  }

  async function download() {
    try {
      const data = await exportMemory()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'bozz-memory.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      pushToast('error', 'Export failed', error instanceof Error ? error.message : undefined)
    }
  }

  const granted = status?.permissionGranted === true

  return (
    <ModulePage
      title="Memory"
      subtitle="Notes you ask BOZZ to remember. Stored only in the local database on this computer. Nothing is learned silently."
      tone={offline ? 'local' : 'live'}
    >
      {offline && <p className="panel-note" role="alert">{offline}</p>}

      {!offline && status && !granted && (
        <section className="memory-gate">
          <p>
            <ShieldCheck aria-hidden="true" /> Memory data is off. Turn it on to let BOZZ keep notes you add. Passwords, keys,
            card numbers and ID numbers are always refused.
          </p>
          <button type="button" className="primary-action" onClick={() => void grant()}>Turn on Memory data</button>
        </section>
      )}

      {granted && status && (
        <>
          <form className="inline-form" onSubmit={submit}>
            <input
              value={text}
              maxLength={status.maxChars}
              onChange={(event) => setText(event.target.value)}
              placeholder="Remember something… (for example: I prefer short answers)"
              aria-label="New memory"
            />
            <button type="submit">Remember</button>
          </form>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={status.useInChat}
              onChange={(event) => void run(() => setMemoryInChat(event.target.checked))}
            />
            <span>
              Use memory in chat. When on, your notes are sent to the AI model as background (a local model keeps them on
              this computer).
            </span>
          </label>

          <div className="inline-form">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                void reload(event.target.value)
              }}
              placeholder="Search memory…"
              aria-label="Search memory"
            />
            <button type="button" onClick={() => void download()}><Download aria-hidden="true" /> Export</button>
          </div>

          <p className="count-line">
            {facts.length === 0
              ? query ? 'Nothing matches that search.' : 'Nothing remembered yet.'
              : `${status.count ?? facts.length} of ${status.maxItems} items`}
          </p>

          <ul className="item-list">
            {facts.map((fact) => (
              <li key={fact.id}>
                {editingId === fact.id ? (
                  <form
                    className="inline-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void run(async () => {
                        await updateMemory(fact.id, editText)
                        setEditingId(null)
                      })
                    }}
                  >
                    <input value={editText} maxLength={status.maxChars} onChange={(event) => setEditText(event.target.value)} aria-label="Edit memory" />
                    <button type="submit">Save</button>
                    <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <span>{fact.text}</span>
                    <small>{when(fact.created_at)}{fact.source !== 'user' ? ` · ${fact.source}` : ''}</small>
                    <button
                      className="delete-btn"
                      aria-label="Edit memory item"
                      onClick={() => {
                        setEditingId(fact.id)
                        setEditText(fact.text)
                      }}
                    >
                      <Pencil />
                    </button>
                    <button
                      className="delete-btn"
                      data-gesture-guard
                      aria-label="Delete memory item"
                      onClick={() => void run(() => deleteMemory(fact.id), 'Deleted.')}
                    >
                      <Trash2 />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {facts.length > 0 && (
            <div className="menu-footer__actions">
              {confirmClear ? (
                <>
                  <span>Delete ALL memory? This cannot be undone.</span>
                  <button
                    type="button"
                    className="secondary-action is-danger"
                    data-gesture-guard
                    onClick={() => {
                      setConfirmClear(false)
                      void run(() => clearMemory(), 'All memory deleted.')
                    }}
                  >
                    Yes, delete everything
                  </button>
                  <button type="button" className="secondary-action" onClick={() => setConfirmClear(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="secondary-action is-danger" onClick={() => setConfirmClear(true)}>Delete all memory</button>
              )}
            </div>
          )}
        </>
      )}

      {message && <p className="panel-note" role="status">{message}</p>}

      {legacy.length > 0 && (
        <section className="memory-legacy">
          <h3>Older notes in this browser ({legacy.length})</h3>
          <p className="panel-note">These were saved before the memory upgrade. They are not used by BOZZ until moved.</p>
          {granted ? (
            <button type="button" className="secondary-action" onClick={() => void moveLegacy()}>Move into BOZZ memory</button>
          ) : (
            <p className="panel-note">Turn on Memory data first to move them.</p>
          )}
        </section>
      )}
    </ModulePage>
  )
}
