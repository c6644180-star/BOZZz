import {
  CircleAlert,
  FlaskConical,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  sourceLabel,
  type BciConversationSummary,
  type BciSource,
} from '../services/bci'
import { formatCount, formatWhen } from './format'

const SOURCES: BciSource[] = ['manual', 'text', 'json', 'whatsapp', 'simulation']

interface ConversationSidebarProps {
  conversations: BciConversationSummary[]
  loading: boolean
  error: string | null
  selectedId: string | null
  query: string
  source: string
  attentionOnly: boolean
  onQuery: (value: string) => void
  onSource: (value: string) => void
  onAttention: (value: boolean) => void
  onSelect: (id: string) => void
  onDelete: (id: string, title: string) => void
  onDeleteAll: () => void
  onPaste: () => void
  onImport: () => void
  onSample: () => void
  onRefresh: () => void
}

export function ConversationSidebar({
  conversations,
  loading,
  error,
  selectedId,
  query,
  source,
  attentionOnly,
  onQuery,
  onSource,
  onAttention,
  onSelect,
  onDelete,
  onDeleteAll,
  onPaste,
  onImport,
  onSample,
  onRefresh,
}: ConversationSidebarProps) {
  return (
    <aside className="bci-sidebar" aria-label="Stored conversations">
      <div className="bci-sidebar-head">
        <h2>Conversations</h2>
        <span className="workspace-chip">{formatCount(conversations.length)}</span>
      </div>

      <div className="bci-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search titles and messages"
          aria-label="Search conversations"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="icon-action" onClick={() => onQuery('')} aria-label="Clear search">
            <X />
          </button>
        )}
      </div>

      <div className="bci-filter-row">
        <label className="bci-source-filter">
          <span>Source</span>
          <select value={source} onChange={(event) => onSource(event.target.value)} aria-label="Filter by source">
            <option value="">All sources</option>
            {SOURCES.map((item) => (
              <option key={item} value={item}>{sourceLabel(item)}</option>
            ))}
          </select>
        </label>
        <label className="bci-attention-toggle">
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(event) => onAttention(event.target.checked)}
          />
          <span>Needs attention</span>
        </label>
      </div>

      <div className="bci-sidebar-actions">
        <button type="button" className="primary-action" onClick={onPaste}>
          <MessageSquarePlus /> Paste
        </button>
        <button type="button" className="ghost-action" onClick={onImport}>
          <Upload /> Import
        </button>
        <button type="button" className="ghost-action" onClick={onSample}>
          <FlaskConical /> Simulation
        </button>
      </div>

      <div className="bci-list" aria-busy={loading}>
        {loading && !conversations.length && (
          <p className="bci-list-status" role="status"><Loader2 /> Loading local conversations…</p>
        )}
        {error && !loading && (
          <p className="bci-list-status is-error" role="alert"><CircleAlert /> {error}</p>
        )}
        {!loading && !error && !conversations.length && (
          <div className="bci-list-empty">
            <p>No conversations yet.</p>
            <p>
              Paste text, import a chat export or load the clearly labelled Simulation sample. Everything stays in the
              local SQLite database.
            </p>
          </div>
        )}
        <ul className="bci-conversation-list">
          {conversations.map((item) => {
            const active = item.id === selectedId
            return (
              <li key={item.id} className={`bci-conversation${active ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="bci-conversation-main"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="bci-conversation-title">{item.title}</span>
                  <span className="bci-conversation-meta">
                    <span className={`bci-source-chip is-${item.source}`}>{sourceLabel(item.source)}</span>
                    <span>{formatCount(item.messages_count)} message{item.messages_count === 1 ? '' : 's'}</span>
                    {item.needs_attention > 0 && (
                      <span className="bci-tag is-warn">{item.needs_attention} attention</span>
                    )}
                    {item.unanswered_count > 0 && (
                      <span className="bci-tag">{item.unanswered_count} unanswered</span>
                    )}
                  </span>
                  {item.search_excerpt && <span className="bci-search-excerpt">{item.search_excerpt}</span>}
                  <span className="bci-conversation-time">
                    {formatWhen(item.last_message_at ?? item.updated_at)}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-action is-danger"
                  onClick={() => onDelete(item.id, item.title)}
                  aria-label={`Delete ${item.title} from the local database`}
                  title="Delete this conversation locally"
                >
                  <Trash2 />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <footer className="bci-sidebar-foot">
        <div className="bci-sidebar-foot-actions">
          <button type="button" className="ghost-action" onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 /> : <RefreshCw />} Refresh
          </button>
          <button
            type="button"
            className="ghost-action is-danger"
            onClick={onDeleteAll}
            disabled={!conversations.length}
          >
            <Trash2 /> Delete all
          </button>
        </div>
        <p>Stored in the local SQLite database only. Nothing is uploaded or sent.</p>
      </footer>
    </aside>
  )
}
