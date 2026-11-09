import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FolderPlus,
  Grid2X2,
  Keyboard,
  Layers,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  Ungroup,
  X,
} from 'lucide-react'
import { useModules } from '../hooks/useModules'
import {
  approveOpen,
  listFolder,
  listLayouts,
  listRoots,
  loadLayout as loadLayoutApi,
  previewFile,
  renameLayout,
  requestOpen,
  saveLayout,
  searchFiles,
  deleteLayout,
  type FileEntry,
  type FilePreview,
  type FileRoot,
  type FolderListing,
  type SearchResult,
  type SpatialLayoutCard,
  type SpatialLayoutSummary,
} from '../services/files'
import { rejectIntent, type IntentView } from '../services/intent'
import { pushToast } from '../services/toast'
import {
  MAX_VISIBLE_CARDS,
  SpatialController,
  registerSpatialController,
  type SpatialCard,
} from '../spatial/controller'
import { SpatialCardView } from '../spatial/SpatialCardView'
import { SpatialSidebar, type SidebarTab } from '../spatial/SpatialSidebar'
import { OpenApproval } from '../spatial/OpenApproval'
import {
  consumePendingFind,
  consumePendingOpen,
  getSpatialBridge,
  subscribeSpatialBridge,
  type PendingFind,
} from '../spatial/spatialBridge'
import '../styles/spatial.css'

const AUTOSAVE_KEY = 'bozz.spatial.autosave'

interface ViewerState {
  name: string
  path: string
  loading: boolean
  error: string | null
  preview: FilePreview | null
}

interface Marquee {
  x: number
  y: number
  w: number
  h: number
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return index > 1 ? trimmed.slice(0, index) : trimmed
}

function cardToEntry(card: SpatialCard): FileEntry {
  return {
    name: card.name,
    path: card.path,
    type: card.type,
    kind: card.kind,
    size: card.size,
    modified: card.modified,
    openable: card.openable,
    blocked_reason: card.blockedReason,
  }
}

export default function SpatialPage() {
  const navigate = useNavigate()
  const [controller] = useState(() => new SpatialController())
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const bridge = useSyncExternalStore(subscribeSpatialBridge, getSpatialBridge, getSpatialBridge)
  const { snapshot: modules, loading: modulesLoading, setPermission, busy } = useModules()
  const spatialModule = modules.modules.find((item) => item.id === 'spatial-desktop')
  const granted = spatialModule?.permissions.find((item) => item.id === 'file_access')?.granted === true

  const [roots, setRoots] = useState<FileRoot[]>([])
  const [rootsLoading, setRootsLoading] = useState(false)
  const [rootsError, setRootsError] = useState<string | null>(null)
  const [currentRoot, setCurrentRoot] = useState<string | null>(null)
  const [listingPath, setListingPath] = useState<string | null>(null)
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [listingLoading, setListingLoading] = useState(false)
  const [listingError, setListingError] = useState<string | null>(null)
  const [tab, setTab] = useState<SidebarTab>('browse')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)

  const [layouts, setLayouts] = useState<SpatialLayoutSummary[]>([])
  const [layoutsLoading, setLayoutsLoading] = useState(false)
  const [layoutName, setLayoutName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [find, setFind] = useState<PendingFind | null>(null)
  const [openTask, setOpenTask] = useState<IntentView | null>(null)
  const [openBusy, setOpenBusy] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    appliedX: number
    appliedY: number
    frame: number | null
  } | null>(null)
  const autosaveReady = useRef(false)

  const refreshRoots = useCallback(async () => {
    setRootsLoading(true)
    try {
      const result = await listRoots()
      setRoots(result.roots)
      setRootsError(null)
    } catch (caught) {
      setRootsError(caught instanceof Error ? caught.message : 'Allowed folders could not be loaded.')
    } finally {
      setRootsLoading(false)
    }
  }, [])

  const navigateListing = useCallback(async (path: string) => {
    setListingPath(path)
    setListingLoading(true)
    setListingError(null)
    try {
      const result = await listFolder(path)
      setListing(result)
    } catch (caught) {
      setListing(null)
      setListingError(caught instanceof Error ? caught.message : 'That folder could not be read.')
    } finally {
      setListingLoading(false)
    }
  }, [])

  const refreshLayouts = useCallback(async () => {
    setLayoutsLoading(true)
    try {
      const result = await listLayouts()
      setLayouts(result.layouts)
    } catch (caught) {
      pushToast('error', 'Layouts unavailable', caught instanceof Error ? caught.message : undefined)
    } finally {
      setLayoutsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!granted) return
    // Loading roots and layouts is the intended fetch-on-grant behaviour.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRoots()
    void refreshLayouts()
  }, [granted, refreshRoots, refreshLayouts])

  useEffect(() => {
    if (!granted || currentRoot || roots.length === 0) return
    const first = roots[0].path
    // Picking the first allowed folder when the list arrives is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentRoot(first)
    void navigateListing(first)
  }, [granted, roots, currentRoot, navigateListing])

  useEffect(() => {
    if (!granted || autosaveReady.current) return
    autosaveReady.current = true
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY)
      if (!raw) return
      const cards = JSON.parse(raw) as SpatialLayoutCard[]
      if (Array.isArray(cards) && cards.length) {
        const count = controller.applyLayout(cards)
        pushToast('info', 'Workspace restored', `${count} card(s) restored from autosave. Files were not opened.`)
      }
    } catch {
      /* Ignore a corrupt autosave; nothing was read from disk. */
    }
  }, [granted, controller])

  useEffect(() => {
    if (!autosaveReady.current || !granted) return
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(controller.layoutCards()))
      } catch {
        /* Storage may be full; the workspace still works in memory. */
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [state.cards, granted, controller])

  useEffect(() => {
    const release = registerSpatialController(controller)
    return release
  }, [controller])

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'folder') {
        setTab('browse')
        void navigateListing(entry.path)
        return
      }
      if (!entry.openable) {
        pushToast('warning', 'File not opened', entry.blocked_reason || 'Executables and scripts are never opened.')
        return
      }
      if (entry.kind === '3d') {
        navigate('/3d')
        pushToast(
          'info',
          'Opening L3DME',
          'Choose this file in the L3DME file picker. The browser cannot read a disk path automatically.',
        )
        return
      }
      if (entry.kind === 'image' || entry.kind === 'text' || entry.kind === 'markdown') {
        setViewer({ name: entry.name, path: entry.path, loading: true, error: null, preview: null })
        void previewFile(entry.path).then(
          (preview) => setViewer({ name: entry.name, path: entry.path, loading: false, error: null, preview }),
          (caught: unknown) =>
            setViewer({
              name: entry.name,
              path: entry.path,
              loading: false,
              error: caught instanceof Error ? caught.message : 'Preview failed.',
              preview: null,
            }),
        )
        return
      }
      setOpenError(null)
      void requestOpen(entry.path).then(
        (intent) => setOpenTask(intent),
        (caught: unknown) =>
          pushToast('error', 'Open request failed', caught instanceof Error ? caught.message : undefined),
      )
    },
    [navigate, navigateListing],
  )

  const openCard = useCallback(
    (card: SpatialCard) => {
      if (card.missing) {
        pushToast('warning', 'File missing', 'That path no longer exists inside an allowed folder.')
        return
      }
      openEntry(cardToEntry(card))
    },
    [openEntry],
  )

  useEffect(() => {
    controller.bindOpen(openCard)
    return () => controller.bindOpen(null)
  }, [controller, openCard])

  useEffect(() => {
    const pending = consumePendingFind()
    if (pending) {
      if (pending.matches.length === 1 && pending.mode === 'find') {
        const card = controller.add(pending.matches[0])
        if (card) pushToast('success', 'Card placed', `"${card.name}" is on the workspace. Nothing was opened.`)
      } else {
        // Results arrive from the module bridge, not from this component's own state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFind(pending)
        setSearchQuery(pending.query)
        setTab('search')
      }
    }
    const opening = consumePendingOpen()
    if (opening) {
      setOpenTask(opening)
      setOpenError(null)
    }
  }, [bridge.revision, controller])

  const addEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'folder') {
        const card = controller.add(entry)
        if (card) pushToast('success', 'Folder card placed', `"${card.name}" is on the workspace.`)
        return
      }
      const card = controller.add(entry)
      if (card) pushToast('success', 'Card placed', `"${card.name}" is on the workspace. Nothing was opened.`)
      else if (controller.getSnapshot().limitReached) {
        pushToast('warning', 'Workspace limit reached', `A workspace shows at most ${MAX_VISIBLE_CARDS} cards.`)
      }
    },
    [controller],
  )

  const addAll = useCallback(
    (entries: FileEntry[]) => {
      let added = 0
      for (const entry of entries) {
        if (controller.getSnapshot().cards.length >= MAX_VISIBLE_CARDS) break
        if (controller.add(entry)) added += 1
      }
      pushToast(
        added ? 'success' : 'warning',
        added ? `${added} card(s) placed` : 'No cards added',
        added ? 'Files were not opened or changed.' : `The workspace limit is ${MAX_VISIBLE_CARDS} cards.`,
      )
    },
    [controller],
  )

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim()
    if (!query) return
    setSearchLoading(true)
    setSearchError(null)
    try {
      const result = await searchFiles(query, { limit: 50 })
      setSearchResult(result)
    } catch (caught) {
      setSearchResult(null)
      setSearchError(caught instanceof Error ? caught.message : 'The search failed.')
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery])

  const isGrouped = state.cards.some((card) => state.selected.includes(card.id) && card.group)

  const applyGroup = useCallback(() => {
    const name = groupName.trim()
    if (!name || state.selected.length === 0) return
    controller.group(state.selected, name)
    setGroupName('')
    pushToast('success', 'Cards grouped', `Label: ${name}. No files were moved.`)
  }, [controller, groupName, state.selected])

  const ungroupSelected = useCallback(() => {
    controller.ungroup(state.selected)
    pushToast('info', 'Group label removed', 'No files were moved.')
  }, [controller, state.selected])

  const dismissCards = useCallback(
    (cards: SpatialCard[]) => {
      if (!cards.length) return
      controller.dismiss(cards.map((card) => card.id))
      setFind(null)
      pushToast(
        'info',
        cards.length === 1 ? 'Card removed (file untouched)' : `${cards.length} cards removed (files untouched)`,
        'Press Ctrl+Z or open the Removed tab to bring the card back.',
        6000,
      )
    },
    [controller],
  )

  const dismissSelected = useCallback(() => {
    dismissCards(controller.selectedCards())
  }, [controller, dismissCards])

  const restoreLast = useCallback(() => {
    const restored = controller.restoreLast()
    if (restored) pushToast('success', 'Card restored', `"${restored.name}" is back. The file was always untouched.`)
    return restored
  }, [controller])

  const restoreOne = useCallback(
    (id: string) => {
      const restored = controller.restore(id)
      if (restored) pushToast('success', 'Card restored', `"${restored.name}" is back.`)
    },
    [controller],
  )

  const restoreAllRemoved = useCallback(() => {
    const ids = controller.getSnapshot().dismissed.map((card) => card.id)
    controller.restoreIds(ids)
    pushToast('success', 'Cards restored', 'Removed cards are back. No files were changed.')
  }, [controller])

  const clearWorkspace = useCallback(() => {
    const count = controller.clearAll()
    if (count) {
      setFind(null)
      pushToast(
        'warning',
        'Workspace cleared',
        `${count} card(s) removed. Nothing was deleted; use Restore workspace to bring them back.`,
        8000,
      )
    }
  }, [controller])

  const restoreWorkspace = useCallback(() => {
    const restored = controller.restoreCleared()
    if (restored.length) pushToast('success', 'Workspace restored', `${restored.length} card(s) are back.`)
  }, [controller])

  const saveCurrentLayout = useCallback(async () => {
    const name = layoutName.trim()
    if (!name) return
    try {
      const result = await saveLayout(name, controller.layoutCards())
      setLayoutName('')
      await refreshLayouts()
      pushToast('success', 'Layout saved', `"${result.layout.name}" stores ${result.layout.cards.length} card position(s). No file was touched.`)
    } catch (caught) {
      pushToast('error', 'Layout was not saved', caught instanceof Error ? caught.message : undefined)
    }
  }, [controller, layoutName, refreshLayouts])

  const loadLayout = useCallback(
    async (id: string) => {
      try {
        const result = await loadLayoutApi(id)
        const count = controller.applyLayout(result.layout.cards)
        pushToast('success', 'Layout loaded', `${count} card(s) placed. Missing files will be marked honestly.`)
      } catch (caught) {
        pushToast('error', 'Layout was not loaded', caught instanceof Error ? caught.message : undefined)
      }
    },
    [controller],
  )

  const renameSavedLayout = useCallback(
    async (id: string, name: string) => {
      if (!name.trim()) return
      try {
        await renameLayout(id, name.trim())
        await refreshLayouts()
        pushToast('success', 'Layout renamed', 'Only its JSON name changed.')
      } catch (caught) {
        pushToast('error', 'Rename failed', caught instanceof Error ? caught.message : undefined)
      }
    },
    [refreshLayouts],
  )

  const deleteSavedLayout = useCallback(
    async (id: string) => {
      try {
        await deleteLayout(id)
        await refreshLayouts()
        pushToast('info', 'Layout deleted', 'Only the saved layout JSON was removed. Files are untouched.')
      } catch (caught) {
        pushToast('error', 'Delete failed', caught instanceof Error ? caught.message : undefined)
      }
    },
    [refreshLayouts],
  )

  const grantAccess = useCallback(async () => {
    const ok = await setPermission('spatial-desktop', 'file_access', true)
    if (ok) pushToast('success', 'File access granted', 'Now allow a specific folder in Settings → File access.')
    await refreshRoots()
  }, [refreshRoots, setPermission])

  const approve = useCallback(async () => {
    if (!openTask?.approval_id) return
    setOpenBusy(true)
    setOpenError(null)
    try {
      const result = await approveOpen(openTask.id, openTask.approval_id)
      setOpenTask(result)
      if (result.status === 'reported') {
        pushToast('success', 'Open requested', result.message)
      } else {
        pushToast('error', 'Open failed', result.message)
      }
    } catch (caught) {
      setOpenError(caught instanceof Error ? caught.message : 'The approval failed.')
    } finally {
      setOpenBusy(false)
    }
  }, [openTask])

  const cancelApproval = useCallback(async () => {
    if (!openTask) return
    const id = openTask.id
    setOpenTask(null)
    setOpenError(null)
    try {
      await rejectIntent(id, 'Cancelled in Spatial Desktop.')
    } catch {
      /* The task may already be closed or the backend may be offline. */
    }
  }, [openTask])

  const onCardPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, card: SpatialCard) => {
      event.stopPropagation()
      if (event.button !== 0) return
      const selected = controller.getSnapshot().selected
      if (!selected.includes(card.id)) controller.select(card.id, event.shiftKey)
      else if (event.shiftKey) controller.select(card.id, true)
    },
    [controller],
  )

  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, card: SpatialCard) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('button')) return
      event.stopPropagation()
      event.preventDefault()
      if (event.shiftKey) {
        controller.select(card.id, true)
        if (!controller.getSnapshot().selected.includes(card.id)) return
      } else if (!controller.getSnapshot().selected.includes(card.id)) {
        controller.select(card.id)
      }
      if (!controller.getSnapshot().selected.length) return
      const drag = { startX: event.clientX, startY: event.clientY, appliedX: 0, appliedY: 0, frame: null as number | null }
      dragRef.current = drag

      const onMove = (moveEvent: PointerEvent) => {
        if (drag.frame !== null) return
        const dx = moveEvent.clientX - drag.startX
        const dy = moveEvent.clientY - drag.startY
        drag.frame = window.requestAnimationFrame(() => {
          drag.frame = null
          if (dragRef.current !== drag) return
          controller.moveSelected(dx - drag.appliedX, dy - drag.appliedY)
          drag.appliedX = dx
          drag.appliedY = dy
        })
      }
      const onUp = () => {
        if (drag.frame !== null) window.cancelAnimationFrame(drag.frame)
        drag.frame = null
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [controller],
  )

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, card: SpatialCard) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()
      controller.select(card.id)
      const startX = event.clientX
      const startY = event.clientY
      const startW = card.w
      const startH = card.h
      let frame: number | null = null
      let latest = { w: startW, h: startH }

      const onMove = (moveEvent: PointerEvent) => {
        latest = { w: startW + moveEvent.clientX - startX, h: startH + moveEvent.clientY - startY }
        if (frame !== null) return
        frame = window.requestAnimationFrame(() => {
          frame = null
          controller.resize(card.id, latest.w, latest.h)
        })
      }
      const onUp = () => {
        if (frame !== null) window.cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', onMove)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [controller],
  )

  const onCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('.spatial-card')) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const origin = {
        x: event.clientX - rect.left + canvas.scrollLeft,
        y: event.clientY - rect.top + canvas.scrollTop,
      }
      if (!event.shiftKey) controller.clearSelection()
      setMarquee({ x: origin.x, y: origin.y, w: 0, h: 0 })

      const boxAt = (moveEvent: PointerEvent) => {
        const x = moveEvent.clientX - rect.left + canvas.scrollLeft
        const y = moveEvent.clientY - rect.top + canvas.scrollTop
        return {
          x: Math.min(origin.x, x),
          y: Math.min(origin.y, y),
          w: Math.abs(x - origin.x),
          h: Math.abs(y - origin.y),
        }
      }
      const onMove = (moveEvent: PointerEvent) => setMarquee(boxAt(moveEvent))
      const onUp = (upEvent: PointerEvent) => {
        const box = boxAt(upEvent)
        const ids = controller
          .getSnapshot()
          .cards.filter(
            (card) =>
              card.x < box.x + box.w &&
              card.x + card.w > box.x &&
              card.y < box.y + box.h &&
              card.y + card.h > box.y,
          )
          .map((card) => card.id)
        controller.selectMany(ids, event.shiftKey)
        setMarquee(null)
        window.removeEventListener('pointermove', onMove)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [controller],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      if (event.key === 'Escape') {
        if (viewer) {
          setViewer(null)
          return
        }
        if (find) {
          setFind(null)
          return
        }
        if (openTask) return
        controller.clearSelection()
        return
      }
      if (event.key === 'Delete') {
        if (!state.selected.length) return
        event.preventDefault()
        dismissSelected()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        restoreLast()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, dismissSelected, find, openTask, restoreLast, state.selected.length, viewer])

  const rootsEmpty = granted && !rootsLoading && roots.length === 0

  return (
    <div className="spatial-page">
      <header className="spatial-toolbar">
        <div className="spatial-brand">
          <Grid2X2 aria-hidden="true" />
          <div>
            <h1>Spatial Desktop</h1>
            <p>Read-only workspace · files are never changed</p>
          </div>
        </div>
        <div className="spatial-chips">
          <span className={`workspace-chip ${granted ? 'is-ok' : 'is-off'}`}>
            {granted ? <ShieldCheck /> : <ShieldOff />} File access {granted ? 'on' : 'off'}
          </span>
          <span className="workspace-chip">{state.cards.length}/{MAX_VISIBLE_CARDS} cards</span>
          {state.selected.length > 0 && <span className="workspace-chip">{state.selected.length} selected</span>}
        </div>
        <div className="spatial-toolbar-actions">
          {state.clearedCount > 0 && (
            <button type="button" className="primary-action" onClick={restoreWorkspace}>
              <Undo2 /> Restore workspace ({state.clearedCount})
            </button>
          )}
          <button type="button" className="ghost-action" onClick={clearWorkspace} disabled={!state.cards.length}>
            <Trash2 /> Clear workspace
          </button>
          <button
            type="button"
            className="icon-action"
            onClick={() => window.dispatchEvent(new Event('bozz:show-shortcuts'))}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          >
            <Keyboard />
          </button>
        </div>
      </header>

      {state.limitReached && (
        <p className="spatial-banner" role="status">
          Workspace limit: at most {MAX_VISIBLE_CARDS} cards are shown. Remove a card to add another. No files were changed.
        </p>
      )}

      {!granted ? (
        <section className="spatial-gate" aria-label="File access required">
          {modulesLoading ? (
            <p role="status"><Loader2 /> Checking the module registry…</p>
          ) : (
            <>
              <ShieldOff aria-hidden="true" />
              <h2>File access is off</h2>
              <p>
                Spatial Desktop can only read folders you explicitly allow. Nothing is allowed by default, and there
                are no delete, move, rename, write or upload endpoints.
              </p>
              <button type="button" className="primary-action" onClick={() => void grantAccess()} disabled={busy !== null}>
                {busy ? <Loader2 /> : <ShieldCheck />} Grant file access for Spatial Desktop
              </button>
              <Link to="/settings#file-access" className="ghost-action"><FolderPlus /> Open File access settings</Link>
            </>
          )}
        </section>
      ) : (
        <div className="spatial-layout">
          <SpatialSidebar
            tab={tab}
            onTab={setTab}
            granted={granted}
            roots={roots}
            rootsLoading={rootsLoading}
            currentRoot={currentRoot}
            listing={listing}
            listingLoading={listingLoading}
            listingError={listingError ?? rootsError}
            onChooseRoot={(path) => {
              setCurrentRoot(path)
              void navigateListing(path)
            }}
            onNavigate={(path) => void navigateListing(path)}
            onUp={() => {
              if (!listing || !currentRoot || listing.path === currentRoot) return
              void navigateListing(parentPath(listing.path))
            }}
            onRefresh={() => listingPath && void navigateListing(listingPath)}
            onAdd={addEntry}
            onOpen={openEntry}
            onAddAll={addAll}
            searchQuery={searchQuery}
            onSearchQuery={setSearchQuery}
            onSearch={() => void runSearch()}
            searchLoading={searchLoading}
            searchError={searchError}
            searchResult={searchResult}
            layouts={layouts}
            layoutsLoading={layoutsLoading}
            layoutName={layoutName}
            onLayoutName={setLayoutName}
            onSaveLayout={() => void saveCurrentLayout()}
            onLoadLayout={(id) => void loadLayout(id)}
            onRenameLayout={(id, name) => void renameSavedLayout(id, name)}
            onDeleteLayout={(id) => void deleteSavedLayout(id)}
            dismissed={state.dismissed}
            onRestore={restoreOne}
            onRestoreAll={restoreAllRemoved}
          />

          <section className="spatial-stage" aria-label="Spatial workspace">
            <div className="spatial-stage-head">
              <span className="workspace-chip" title={listing?.path ?? ''}>
                <Layers /> {listing?.path ?? currentRoot ?? 'No folder open'}
              </span>
              {state.selected.length >= 2 && (
                <form
                  className="spatial-group"
                  onSubmit={(event) => {
                    event.preventDefault()
                    applyGroup()
                  }}
                >
                  <input
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder="Group label"
                    aria-label="Labelled group name"
                    maxLength={120}
                  />
                  <button type="submit" className="primary-action" disabled={!groupName.trim()}>Group</button>
                </form>
              )}
              {isGrouped && (
                <button type="button" className="ghost-action" onClick={ungroupSelected}>
                  <Ungroup /> Remove label
                </button>
              )}
            </div>

            <div
              ref={canvasRef}
              className="spatial-canvas"
              onPointerDown={onCanvasPointerDown}
              role="application"
              aria-label="Spatial workspace canvas. Use Tab to focus a card, Enter to open it, Delete to remove the card, and Ctrl+Z to restore."
            >
              {state.cards.map((card) => (
                <SpatialCardView
                  key={card.id}
                  card={card}
                  selected={state.selected.includes(card.id)}
                  controller={controller}
                  onCardPointerDown={onCardPointerDown}
                  onHeaderPointerDown={onHeaderPointerDown}
                  onResizePointerDown={onResizePointerDown}
                  onOpen={openCard}
                  onDismiss={(item) => dismissCards([item])}
                />
              ))}
              {marquee && (
                <div
                  className="spatial-marquee"
                  style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                  aria-hidden="true"
                />
              )}
              {state.cards.length === 0 && (
                <div className="spatial-empty">
                  <Grid2X2 />
                  <h2>Your workspace is empty</h2>
                  <p>Place real files from Browse, or ask the command bar: “find my project logo”.</p>
                  <div>
                    <button type="button" className="primary-action" onClick={() => setTab('browse')} disabled={rootsEmpty}>
                      <FolderPlus /> Browse allowed folders
                    </button>
                    <Link to="/settings#file-access" className="ghost-action">Manage folders</Link>
                  </div>
                </div>
              )}
            </div>

            <div className="spatial-hint">
              Double-click a card to open · Shift-click to multi-select · drag empty space to box-select · Delete removes a
              card · Ctrl+Z restores · the file is never touched by a card action
            </div>
          </section>
        </div>
      )}

      {find && (
        <div className="spatial-find-panel" role="dialog" aria-label="Search results">
          <header>
            <div>
              <strong>{find.note}</strong>
              <small>Task recorded in Intent Map. This search was read-only.</small>
            </div>
            <button type="button" className="icon-action" onClick={() => setFind(null)} aria-label="Close results"><X /></button>
          </header>
          {find.matches.length === 0 ? (
            <p className="spatial-side-note">No matches. Nothing was opened or changed.</p>
          ) : (
            <ul>
              {find.matches.map((entry) => (
                <li key={entry.path}>
                  <div>
                    <strong>{entry.name}</strong>
                    <small title={entry.path}>{entry.path}</small>
                  </div>
                  <div className="spatial-find-actions">
                    <button type="button" className="ghost-action" onClick={() => addEntry(entry)}><Plus /> Card</button>
                    <button type="button" className="primary-action" onClick={() => openEntry(entry)}>
                      {find.mode === 'open' ? 'Open (asks approval)' : 'Open'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/intent-map?intent=${encodeURIComponent(find.taskId)}`} className="spatial-find-link">
            View the Intent Map task
          </Link>
        </div>
      )}

      {openTask && (
        <OpenApproval
          intent={openTask}
          busy={openBusy}
          error={openError}
          onApprove={() => void approve()}
          onCancel={() => void cancelApproval()}
          onClose={() => {
            setOpenTask(null)
            setOpenError(null)
          }}
        />
      )}

      {viewer && (
        <div className="spatial-modal-layer" onMouseDown={() => setViewer(null)}>
          <div
            className="spatial-modal spatial-viewer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="spatial-viewer-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="spatial-viewer-title">{viewer.name}</h2>
              <button type="button" className="icon-button" onClick={() => setViewer(null)} aria-label="Close preview"><X /></button>
            </header>
            {viewer.loading && <p role="status"><Loader2 /> Loading the preview…</p>}
            {viewer.error && <p className="spatial-side-error" role="alert">{viewer.error}</p>}
            {viewer.preview?.preview_kind === 'text' && (
              <pre className="spatial-viewer-text">{viewer.preview.text}</pre>
            )}
            {viewer.preview?.preview_kind === 'image' && viewer.preview.thumbnail_url && (
              <img src={viewer.preview.thumbnail_url} alt={viewer.name} className="spatial-viewer-image" />
            )}
            <p className="spatial-modal__note">
              Read-only preview from an allowed folder.{' '}
              {viewer.preview?.preview_kind === 'text' && 'Text is limited to the first 4 KB.'}{' '}
              {viewer.preview?.preview_kind === 'image' && 'The image is a 512 px thumbnail.'} BOZZ does not write files.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
