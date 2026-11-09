import { useState } from 'react'
import {
  ArrowLeft,
  Folder,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FileEntry, FileRoot, FolderListing, SearchResult, SpatialLayoutSummary } from '../services/files'
import type { SpatialCard } from './controller'
import { formatBytes, kindLabel } from './format'

export type SidebarTab = 'browse' | 'search' | 'layouts' | 'removed'

interface SidebarProps {
  tab: SidebarTab
  onTab: (tab: SidebarTab) => void
  granted: boolean
  roots: FileRoot[]
  rootsLoading: boolean
  currentRoot: string | null
  listing: FolderListing | null
  listingLoading: boolean
  listingError: string | null
  onChooseRoot: (path: string) => void
  onNavigate: (path: string) => void
  onUp: () => void
  onRefresh: () => void
  onAdd: (entry: FileEntry) => void
  onOpen: (entry: FileEntry) => void
  onAddAll: (entries: FileEntry[]) => void
  searchQuery: string
  onSearchQuery: (value: string) => void
  onSearch: () => void
  searchLoading: boolean
  searchError: string | null
  searchResult: SearchResult | null
  layouts: SpatialLayoutSummary[]
  layoutsLoading: boolean
  layoutName: string
  onLayoutName: (value: string) => void
  onSaveLayout: () => void
  onLoadLayout: (id: string) => void
  onRenameLayout: (id: string, name: string) => void
  onDeleteLayout: (id: string) => void
  dismissed: SpatialCard[]
  onRestore: (id: string) => void
  onRestoreAll: () => void
}

function EntryIcon({ entry }: { entry: FileEntry }) {
  return entry.type === 'folder' ? <Folder /> : <span className="spatial-entry__dot" data-kind={entry.kind} />
}

export function SpatialSidebar(props: SidebarProps) {
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const activeEditId = editId && props.layouts.some((layout) => layout.id === editId) ? editId : null

  return (
    <aside className="spatial-sidebar" aria-label="Spatial Desktop browser">
      <nav className="spatial-tabs" role="tablist" aria-label="Spatial panels">
        {([
          ['browse', 'Browse'],
          ['search', 'Search'],
          ['layouts', 'Layouts'],
          ['removed', `Removed${props.dismissed.length ? ` (${props.dismissed.length})` : ''}`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={props.tab === id}
            className={props.tab === id ? 'is-active' : ''}
            onClick={() => props.onTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!props.granted ? (
        <div className="spatial-side-empty">
          <p>File access is off. Spatial Desktop cannot read anything until you allow a folder.</p>
          <Link className="primary-action" to="/settings#file-access">Open File access settings</Link>
        </div>
      ) : props.tab === 'browse' ? (
        <div className="spatial-side-panel">
          <div className="spatial-roots">
            {props.rootsLoading ? (
              <p className="spatial-side-note" role="status"><Loader2 /> Loading allowed folders…</p>
            ) : props.roots.length === 0 ? (
              <div className="spatial-side-empty">
                <p>No folders are allowed yet. Nothing can be read.</p>
                <Link className="primary-action" to="/settings#file-access">Allow a folder</Link>
              </div>
            ) : (
              props.roots.map((root) => (
                <button
                  key={root.path}
                  type="button"
                  className={props.currentRoot === root.path ? 'spatial-root is-active' : 'spatial-root'}
                  onClick={() => props.onChooseRoot(root.path)}
                  title={root.path}
                >
                  <FolderOpen />
                  <span>{root.label}</span>
                </button>
              ))
            )}
          </div>

          {props.listing && (
            <>
              <div className="spatial-listing-head">
                <button type="button" className="icon-action" onClick={props.onUp} aria-label="Up one folder" disabled={!props.currentRoot || props.listing.path === props.currentRoot}>
                  <ArrowLeft />
                </button>
                <span title={props.listing.path}>{props.listing.name}</span>
                <button type="button" className="icon-action" onClick={props.onRefresh} aria-label="Refresh folder" disabled={props.listingLoading}>
                  <RefreshCw />
                </button>
              </div>
              {props.listing.truncated && (
                <p className="spatial-side-note">This folder is large; only the first 2,000 entries are shown.</p>
              )}
              {props.listingLoading ? (
                <p className="spatial-side-note" role="status"><Loader2 /> Reading this folder…</p>
              ) : (
                <ul className="spatial-entries">
                  {props.listing.entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className="spatial-entry"
                        onClick={() => (entry.type === 'folder' ? props.onNavigate(entry.path) : props.onOpen(entry))}
                        title={entry.path}
                      >
                        <EntryIcon entry={entry} />
                        <span className="spatial-entry__name">{entry.name}</span>
                        <small>{entry.type === 'folder' ? 'folder' : formatBytes(entry.size)}</small>
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        onClick={() => props.onAdd(entry)}
                        aria-label={`Place ${entry.name} on the workspace`}
                        title="Place a card"
                      >
                        <Plus />
                      </button>
                    </li>
                  ))}
                  {props.listing.entries.length === 0 && (
                    <li className="spatial-side-note">This folder is empty.</li>
                  )}
                </ul>
              )}
              <button type="button" className="ghost-action" onClick={() => props.onAddAll(props.listing?.entries ?? [])}>
                <Plus /> Place all visible entries
              </button>
            </>
          )}

          {props.listingError && <p className="spatial-side-error" role="alert">{props.listingError}</p>}
          {props.roots.length === 0 && <p className="spatial-side-note">Add a folder in Settings → File access.</p>}
        </div>
      ) : props.tab === 'search' ? (
        <div className="spatial-side-panel">
          <form
            className="spatial-search"
            onSubmit={(event) => {
              event.preventDefault()
              props.onSearch()
            }}
          >
            <Search aria-hidden="true" />
            <input
              type="search"
              value={props.searchQuery}
              onChange={(event) => props.onSearchQuery(event.target.value)}
              placeholder="Find a file by name"
              aria-label="Search allowed folders"
            />
            <button type="submit" className="primary-action" disabled={props.searchLoading || !props.searchQuery.trim()}>
              {props.searchLoading ? <Loader2 /> : 'Find'}
            </button>
          </form>
          <p className="spatial-side-note">Read-only search. Hidden, system and dependency folders are skipped.</p>
          {props.searchError && <p className="spatial-side-error" role="alert">{props.searchError}</p>}
          {props.searchResult && (
            <>
              <p className="spatial-side-note">
                {props.searchResult.count} match(es) for “{props.searchResult.query}”
                {props.searchResult.cached ? ' · cached' : ''}
                {props.searchResult.truncated ? ' · scan stopped at the safety limit' : ''}
              </p>
              <ul className="spatial-entries">
                {props.searchResult.matches.map((entry) => (
                  <li key={entry.path}>
                    <button type="button" className="spatial-entry" onClick={() => props.onOpen(entry)} title={entry.path}>
                      <EntryIcon entry={entry} />
                      <span className="spatial-entry__name">{entry.name}</span>
                      <small>{entry.kind}</small>
                    </button>
                    <button
                      type="button"
                      className="icon-action"
                      onClick={() => props.onAdd(entry)}
                      aria-label={`Place ${entry.name} on the workspace`}
                    >
                      <Plus />
                    </button>
                  </li>
                ))}
                {props.searchResult.matches.length === 0 && <li className="spatial-side-note">No matches. Nothing was opened.</li>}
              </ul>
            </>
          )}
        </div>
      ) : props.tab === 'layouts' ? (
        <div className="spatial-side-panel">
          <div className="spatial-layout-save">
            <input
              type="text"
              value={props.layoutName}
              onChange={(event) => props.onLayoutName(event.target.value)}
              placeholder="Layout name"
              maxLength={120}
              aria-label="Layout name"
            />
            <button type="button" className="primary-action" onClick={props.onSaveLayout} disabled={!props.layoutName.trim()}>
              Save
            </button>
          </div>
          <p className="spatial-side-note">Layouts store card positions as JSON only. Saving a layout never touches a file.</p>
          {props.layoutsLoading ? (
            <p className="spatial-side-note" role="status"><Loader2 /> Loading layouts…</p>
          ) : props.layouts.length === 0 ? (
            <p className="spatial-side-note">No saved layouts yet.</p>
          ) : (
            <ul className="spatial-layouts">
              {props.layouts.map((layout) => (
                <li key={layout.id}>
                  {activeEditId === layout.id ? (
                    <form
                      className="spatial-layout-edit"
                      onSubmit={(event) => {
                        event.preventDefault()
                        props.onRenameLayout(layout.id, editName)
                        setEditId(null)
                      }}
                    >
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} aria-label="New layout name" />
                      <button type="submit" className="icon-action" aria-label="Save name"><Pencil /></button>
                      <button type="button" className="icon-action" onClick={() => setEditId(null)} aria-label="Cancel rename"><X /></button>
                    </form>
                  ) : (
                    <>
                      <button type="button" className="spatial-layout-load" onClick={() => props.onLoadLayout(layout.id)}>
                        <strong>{layout.name}</strong>
                        <small>{layout.card_count} card(s) · {new Date(layout.updated_at).toLocaleString()}</small>
                      </button>
                      <div className="spatial-layout-actions">
                        <button type="button" className="icon-action" onClick={() => { setEditId(layout.id); setEditName(layout.name) }} aria-label={`Rename ${layout.name}`}><Pencil /></button>
                        {deleteId === layout.id ? (
                          <>
                            <button type="button" className="icon-action is-danger" onClick={() => { props.onDeleteLayout(layout.id); setDeleteId(null) }} aria-label={`Confirm delete ${layout.name}`}><Trash2 /></button>
                            <button type="button" className="icon-action" onClick={() => setDeleteId(null)} aria-label="Cancel delete"><X /></button>
                          </>
                        ) : (
                          <button type="button" className="icon-action" onClick={() => setDeleteId(layout.id)} aria-label={`Delete ${layout.name}`}><Trash2 /></button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {deleteId && <p className="spatial-side-note is-warning">Deleting a layout removes only its JSON. Files are untouched.</p>}
        </div>
      ) : (
        <div className="spatial-side-panel">
          <p className="spatial-side-note">
            Removed cards are kept here for this session. Removing a card never deletes the file.
          </p>
          {props.dismissed.length === 0 ? (
            <p className="spatial-side-note">Nothing has been removed.</p>
          ) : (
            <>
              <ul className="spatial-entries">
                {props.dismissed.map((card) => (
                  <li key={card.id}>
                    <span className="spatial-entry">
                      <Folder />
                      <span className="spatial-entry__name">{card.name}</span>
                      <small>{kindLabel(card)}</small>
                    </span>
                    <button type="button" className="icon-action" onClick={() => props.onRestore(card.id)} aria-label={`Restore ${card.name}`}><RotateCcw /></button>
                  </li>
                ))}
              </ul>
              <button type="button" className="ghost-action" onClick={props.onRestoreAll}><RotateCcw /> Restore all removed cards</button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
