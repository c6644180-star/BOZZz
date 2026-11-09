import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'
import { loadNotes, onLocalStoreChange, saveNotes, uid } from '../services/localStore'
import type { MemoryNote } from '../types/bozz'

export default function MemoryPage() {
  const [notes, setNotes] = useState<MemoryNote[]>(() => loadNotes())
  const [text, setText] = useState('')

  useEffect(() => onLocalStoreChange(() => setNotes(loadNotes())), [])

  function persist(next: MemoryNote[]) {
    setNotes(next)
    saveNotes(next)
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    persist([{ id: uid(), text: value, createdAt: Date.now() }, ...notes])
    setText('')
  }

  return (
    <ModulePage title="Memory" subtitle="Local notes kept in this browser. Nothing is sent to a memory service — none is connected." tone="local">
      <form className="inline-form" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Remember something…" aria-label="New memory note" />
        <button type="submit">Save note</button>
      </form>
      <p className="count-line">{notes.length === 0 ? 'No notes stored yet.' : `${notes.length} note${notes.length === 1 ? '' : 's'} on this device`}</p>
      <ul className="item-list">
        {notes.map((note) => (
          <li key={note.id}>
            <span>{note.text}</span>
            <small>{new Date(note.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
            <button className="delete-btn" data-gesture-guard onClick={() => persist(notes.filter((n) => n.id !== note.id))} aria-label="Delete note"><Trash2 /></button>
          </li>
        ))}
      </ul>
    </ModulePage>
  )
}
