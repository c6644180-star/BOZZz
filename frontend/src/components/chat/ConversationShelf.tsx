import { useCallback, useEffect, useState } from 'react'
import { Download, MessageSquarePlus, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { pushToast } from '../../services/toast'

type ConversationSummary = {
  id: string
  title: string
  messages_count: number
  updated_at: string
}

export function ConversationShelf() {
  const { conversationId, openConversation, resetConversation } = useBozzVoice()
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/conversations?limit=50')
      const body = await response.json().catch(() => ({})) as {
        conversations?: ConversationSummary[]
        detail?: string
      }
      if (!response.ok) throw new Error(body.detail || 'Could not load saved conversations.')
      setItems(Array.isArray(body.conversations) ? body.conversations : [])
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load saved conversations.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onChanged = () => void refresh()
    window.addEventListener('bozz:conversation-updated', onChanged)
    window.addEventListener('bozz:identity-changed', onChanged)
    return () => {
      window.removeEventListener('bozz:conversation-updated', onChanged)
      window.removeEventListener('bozz:identity-changed', onChanged)
    }
  }, [refresh])

  async function select(id: string) {
    try {
      await openConversation(id)
    } catch (caught) {
      pushToast('error', 'Conversation could not open', caught instanceof Error ? caught.message : 'Restore failed.')
      void refresh()
    }
  }

  async function rename(id: string, currentTitle: string) {
    const title = window.prompt('Rename this conversation', currentTitle)?.trim()
    if (!title || title === currentTitle) return
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const body = await response.json().catch(() => ({})) as { detail?: string }
      if (!response.ok) throw new Error(body.detail || 'Rename failed.')
      pushToast('success', 'Conversation renamed', title)
      await refresh()
    } catch (caught) {
      pushToast('error', 'Rename failed', caught instanceof Error ? caught.message : 'Rename failed.')
    }
  }

  async function exportConversation(id: string) {
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/export`)
      const body = await response.json().catch(() => ({})) as { detail?: string }
      if (!response.ok) throw new Error(body.detail || 'Export failed.')
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `bozz-conversation-${id}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      pushToast('success', 'Conversation exported', 'The JSON export was prepared on this device.')
    } catch (caught) {
      pushToast('error', 'Export failed', caught instanceof Error ? caught.message : 'Export failed.')
    }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Permanently delete “${title}” from this device?`)) return
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const body = await response.json().catch(() => ({})) as { detail?: string }
      if (!response.ok) throw new Error(body.detail || 'Delete failed.')
      if (conversationId === id) resetConversation()
      pushToast('success', 'Conversation deleted', 'Its messages were removed from the local database.')
      await refresh()
    } catch (caught) {
      pushToast('error', 'Delete failed', caught instanceof Error ? caught.message : 'Delete failed.')
    }
  }

  return (
    <section className="conversation-shelf" aria-label="Saved conversations">
      <div className="conversation-shelf__header">
        <strong>Saved conversations</strong>
        <div>
          <button type="button" onClick={resetConversation} title="Start a new conversation">
            <MessageSquarePlus /> New
          </button>
          <button type="button" onClick={() => void refresh()} disabled={loading} title="Refresh conversations">
            <RefreshCw />
          </button>
        </div>
      </div>
      {error && <p className="conversation-shelf__note" role="alert">{error}</p>}
      {!error && !items.length && !loading && (
        <p className="conversation-shelf__note">Your saved chats will appear here.</p>
      )}
      <ul className="conversation-shelf__list" aria-busy={loading}>
        {items.map((item) => (
          <li key={item.id} className={item.id === conversationId ? 'is-active' : ''}>
            <button type="button" className="conversation-shelf__open" onClick={() => void select(item.id)}>
              <span>{item.title}</span>
              <small>{item.messages_count} messages · {new Date(item.updated_at).toLocaleDateString()}</small>
            </button>
            <div className="conversation-shelf__actions">
              <button type="button" onClick={() => void rename(item.id, item.title)} aria-label={`Rename ${item.title}`} title="Rename">
                <Pencil />
              </button>
              <button type="button" onClick={() => void exportConversation(item.id)} aria-label={`Export ${item.title}`} title="Export JSON">
                <Download />
              </button>
              <button type="button" onClick={() => void remove(item.id, item.title)} aria-label={`Delete ${item.title}`} title="Delete">
                <Trash2 />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
