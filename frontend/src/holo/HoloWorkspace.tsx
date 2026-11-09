import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  ScanEye,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react'
import { OpenApproval } from '../spatial/OpenApproval'
import { approveOpen, listFolder, listLayouts, listRoots, loadLayout, previewFile, requestOpen, saveLayout, thumbnailUrl, type FileEntry, type FilePreview, type FileRoot, type SpatialLayoutCard, type SpatialLayoutSummary } from '../services/files'
import { rejectIntent, type IntentView } from '../services/intent'
import { pushToast } from '../services/toast'
import { useModules } from '../hooks/useModules'
import { loadHgiSettings } from '../hgi/storage/settingsStore'
import { HoloScene, type HoloGestureStatus, type HoloQuality, type HoloSceneApi } from './HoloScene'
import { HoloModelViewer } from './HoloModelViewer'
import { buildVisibleTree, MAX_CHILDREN_PER_FOLDER, MAX_VISIBLE_NODES, type HoloNode } from './layout'
import { consumePendingFolder, getHoloBridge, subscribeHoloBridge } from './holoBridge'
import { registerHoloControl, type HoloControlApi } from './commands'
import { isHoloModel } from './modelSource'

const QUALITY_OPTIONS: Array<{ id: HoloQuality; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function entryFromPath(path: string): FileEntry {
  return {
    name: baseName(path),
    path,
    type: 'folder',
    kind: 'folder',
    size: 0,
    modified: '',
    openable: false,
    blocked_reason: null,
  }
}

function entryFromRoot(root: FileRoot): FileEntry {
  return {
    name: root.label,
    path: root.path,
    type: 'folder',
    kind: 'folder',
    size: 0,
    modified: root.granted_at,
    openable: false,
    blocked_reason: null,
  }
}

function entryFromNode(node: HoloNode): FileEntry {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    kind: node.kind,
    size: node.size,
    modified: node.modified,
    openable: node.openable,
    blocked_reason: node.blockedReason,
  }
}

export function HoloWorkspace() {
  const { snapshot, setPermission, busy } = useModules()
  const holoModule = snapshot.modules.find((item) => item.id === 'holo-projects')
  const spatialModule = snapshot.modules.find((item) => item.id === 'spatial-desktop')
  const holoGranted = holoModule?.permissions.find((item) => item.id === 'file_access')?.granted === true
  const spatialGranted = spatialModule?.permissions.find((item) => item.id === 'file_access')?.granted === true
  const granted = holoGranted || spatialGranted

  const hgiSettings = useMemo(() => loadHgiSettings(), [])
  const minConfidence = hgiSettings.minConfidence

  const [roots, setRoots] = useState<FileRoot[]>([])
  const [rootsLoading, setRootsLoading] = useState(true)
  const [rootEntry, setRootEntry] = useState<FileEntry | null>(null)
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [gestureStatus, setGestureStatus] = useState<HoloGestureStatus>({ gesture: null, node: null })
  const [filterImages, setFilterImages] = useState(false)
  const [quality, setQuality] = useState<HoloQuality>('medium')
  const [gesturesEnabled, setGesturesEnabled] = useState(true)
  const [status, setStatus] = useState('Holographic Projects is read-only. It never writes, moves, renames or deletes a file.')
  const [error, setError] = useState<string | null>(null)

  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [model, setModel] = useState<FileEntry | null>(null)
  const [openTask, setOpenTask] = useState<IntentView | null>(null)
  const [openBusy, setOpenBusy] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pendingFolder, setPendingFolder] = useState<{ label: string; note: string; matches: FileEntry[] } | null>(null)

  const [layouts, setLayouts] = useState<SpatialLayoutSummary[]>([])
  const [layoutsLoading, setLayoutsLoading] = useState(false)
  const [layoutName, setLayoutName] = useState('')

  const sceneApiRef = useRef<HoloSceneApi | null>(null)
  const historyRef = useRef<FileEntry[]>([])
  const rootEntryRef = useRef<FileEntry | null>(null)
  const nodesRef = useRef<HoloNode[]>([])
  const expandedRef = useRef(expanded)
  const filterRef = useRef(filterImages)

  const rootIsAllowed = Boolean(rootEntry && roots.some((root) => root.path === rootEntry.path))

  const visibleNodes = useMemo<HoloNode[]>(() => {
    if (!rootEntry) return []
    return buildVisibleTree(rootEntry, childrenByPath, expanded, { filterImages })
  }, [rootEntry, childrenByPath, expanded, filterImages])

  useEffect(() => {
    rootEntryRef.current = rootEntry
    expandedRef.current = expanded
    filterRef.current = filterImages
    nodesRef.current = visibleNodes
  }, [rootEntry, expanded, filterImages, visibleNodes])

  const selectedKey = selected && visibleNodes.some((node) => node.key === selected) ? selected : null
  const hoveredNode = hovered ? visibleNodes.find((node) => node.key === hovered) ?? null : null
  const selectedNode = selectedKey ? visibleNodes.find((node) => node.key === selectedKey) ?? null : null
  const truncated = visibleNodes.length >= MAX_VISIBLE_NODES

  const ensureChildren = useCallback(async (path: string) => {
    setPendingPaths((current) => new Set(current).add(path))
    try {
      const listing = await listFolder(path)
      setChildrenByPath((current) => ({ ...current, [path]: listing.entries }))
      setStatus(`Read ${listing.count} entr${listing.count === 1 ? 'y' : 'ies'} from "${baseName(path)}". Nothing on disk changed.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not read the folder "${baseName(path)}".`)
    } finally {
      setPendingPaths((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }, [])

  const activateRoot = useCallback(async (entry: FileEntry, options: { pushHistory?: boolean; clearHistory?: boolean } = {}) => {
    setError(null)
    setPreview(null)
    setModel(null)
    setPendingFolder(null)
    try {
      const listing = await listFolder(entry.path)
      if (rootEntryRef.current && options.pushHistory) historyRef.current.push(rootEntryRef.current)
      if (options.clearHistory) historyRef.current = []
      rootEntryRef.current = entry
      setRootEntry(entry)
      setChildrenByPath({ [entry.path]: listing.entries })
      // A folder opened as the root shows its direct children right away.
      setExpanded(new Set([entry.path]))
      setSelected(null)
      setStatus(`Showing "${entry.name}". ${listing.count} entr${listing.count === 1 ? 'y' : 'ies'} read from disk.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not read "${entry.name}".`)
    }
  }, [])

  const refreshRoots = useCallback(async () => {
    setRootsLoading(true)
    try {
      const result = await listRoots()
      setRoots(result.roots)
      if (!rootEntryRef.current && result.roots.length > 0) {
        await activateRoot(entryFromRoot(result.roots[0]), { clearHistory: true })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Allowed folders could not be loaded.')
    } finally {
      setRootsLoading(false)
    }
  }, [activateRoot])

  const refreshLayouts = useCallback(async () => {
    setLayoutsLoading(true)
    try {
      const result = await listLayouts()
      setLayouts(result.layouts)
    } catch {
      /* Layouts are optional; the scene still works without them. */
    } finally {
      setLayoutsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!granted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRootsLoading(false)
      return
    }
    // Reading the configured folders once on grant is the intended fetch pattern.
    void refreshRoots()
    void refreshLayouts()
  }, [granted, refreshRoots, refreshLayouts])

  const bridge = useSyncExternalStore(subscribeHoloBridge, getHoloBridge, getHoloBridge)
  const handledRevisionRef = useRef(0)
  useEffect(() => {
    if (bridge.revision === handledRevisionRef.current) return
    handledRevisionRef.current = bridge.revision
    const folder = consumePendingFolder()
    if (!folder) return
    if (folder.matches.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(folder.note || `No folder matching "${folder.label}" was found in the folders you allow. Nothing was opened.`)
      return
    }
    if (folder.matches.length === 1) {
      void activateRoot(folder.matches[0], { clearHistory: true })
      return
    }
    setPendingFolder({ label: folder.label, note: folder.note, matches: folder.matches })
  }, [bridge.revision, activateRoot])

  const toggleFolder = useCallback((node: HoloNode) => {
    if (expandedRef.current.has(node.path)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(node.path)
        return next
      })
      setStatus(`Collapsed "${node.name}". Nothing on disk changed.`)
      return
    }
    setExpanded((current) => new Set(current).add(node.path))
    setStatus(`Expanding "${node.name}". Reading its direct children…`)
    if (!childrenByPath[node.path]) void ensureChildren(node.path)
  }, [childrenByPath, ensureChildren])

  const openPreview = useCallback(async (entry: FileEntry) => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const result = await previewFile(entry.path)
      setPreview(result)
      setStatus(`Preview of "${entry.name}" read locally. The file was not opened or changed.`)
    } catch (caught) {
      setPreviewError(caught instanceof Error ? caught.message : 'The preview could not be read.')
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const requestSafeOpen = useCallback(async (entry: FileEntry) => {
    setOpenError(null)
    setStatus(`"This opens in another app." Requesting approval to hand "${entry.name}" to the operating system.`)
    try {
      const task = await requestOpen(entry.path)
      setOpenTask(task)
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The open request failed.')
    }
  }, [])

  const openNode = useCallback(async (node: HoloNode) => {
    if (node.isMore) {
      setStatus(`This folder holds ${node.hiddenCount} more entries than the ${MAX_CHILDREN_PER_FOLDER}-node limit. Open it in Spatial Desktop to see the rest. Nothing was opened.`)
      return
    }
    if (!node.openable) {
      setStatus(`BOZZ will not open "${node.name}": ${node.blockedReason ?? 'this file type is blocked.'} The node stays visible and the file is untouched.`)
      return
    }
    const entry = entryFromNode(node)
    if (isHoloModel(node.path)) {
      setModel(entry)
      setPreview(null)
      setStatus(`Loaded "${node.name}" into the hologram model view. Read-only; the file is unchanged.`)
      return
    }
    if (node.kind === 'image' || node.kind === 'text' || node.kind === 'markdown' || node.kind === 'pdf' || node.kind === 'video') {
      await openPreview(entry)
      return
    }
    await requestSafeOpen(entry)
  }, [openPreview, requestSafeOpen])

  const handleTap = useCallback((key: string, count: 1 | 2) => {
    const node = nodesRef.current.find((item) => item.key === key)
    if (!node) return
    setSelected(key)
    if (node.isMore) {
      if (count === 2) void openNode(node)
      return
    }
    if (count === 1) {
      if (node.type === 'folder') toggleFolder(node)
      else setStatus(`Selected "${node.name}". Double-click, double-tap or quick-pinch twice to open it.`)
      return
    }
    if (node.type === 'folder') {
      void activateRoot(entryFromNode(node), { pushHistory: true })
    } else {
      void openNode(node)
    }
  }, [activateRoot, openNode, toggleFolder])

  const goBack = useCallback(() => {
    if (model) {
      setModel(null)
      setStatus('Closed the model view. The file is untouched.')
      return true
    }
    if (preview) {
      setPreview(null)
      setStatus('Closed the preview. The file is untouched.')
      return true
    }
    if (pendingFolder) {
      setPendingFolder(null)
      setStatus('Dismissed the folder choices. Nothing was opened.')
      return true
    }
    const previous = historyRef.current.pop()
    if (previous) {
      void activateRoot(previous)
      return true
    }
    setStatus('You are already at the top level of this allowed folder. Use the allowed-folder buttons to switch roots.')
    return false
  }, [activateRoot, model, pendingFolder, preview])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        sceneApiRef.current?.resetView()
        setStatus('Reset the camera to the home view.')
        return
      }
      if (event.key === 'Escape') {
        const hadSomething = Boolean(model || preview || pendingFolder)
        if (hadSomething || historyRef.current.length > 0) {
          event.preventDefault()
          goBack()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, model, pendingFolder, preview])

  const grantAccess = useCallback(async () => {
    const ok = await setPermission('holo-projects', 'file_access', true)
    if (ok) pushToast('success', 'File access granted', 'Holographic Projects can now read the folders you allow. It stays read-only.')
  }, [setPermission])

  const approve = useCallback(async () => {
    if (!openTask?.approval_id) return
    setOpenBusy(true)
    setOpenError(null)
    try {
      const result = await approveOpen(openTask.id, openTask.approval_id)
      setOpenTask(result)
      if (result.status === 'reported') pushToast('success', 'Open requested', result.message)
      else pushToast('error', 'Open failed', result.message)
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
      await rejectIntent(id, 'Cancelled in Holographic Projects.')
    } catch {
      /* The task may already be closed or the backend may be offline. */
    }
  }, [openTask])

  const saveCurrentView = useCallback(async () => {
    if (!rootEntry) return
    const name = layoutName.trim()
    if (!name) return
    const camera = sceneApiRef.current?.getCamera() ?? null
    const holo = {
      root: rootEntry.path,
      expanded: Array.from(expanded),
      filterImages,
      ...(camera ? { camera } : {}),
    }
    const card: SpatialLayoutCard = {
      id: 'holo-view',
      path: rootEntry.path,
      name: rootEntry.name,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      z: 0,
      holo,
    }
    try {
      const result = await saveLayout(name, [card])
      setLayoutName('')
      await refreshLayouts()
      pushToast('success', 'Hologram view saved', `"${result.layout.name}" stores the camera and ${expanded.size} expanded folder(s) as JSON. No file was touched.`)
    } catch (caught) {
      pushToast('error', 'View was not saved', caught instanceof Error ? caught.message : undefined)
    }
  }, [expanded, filterImages, layoutName, refreshLayouts, rootEntry])

  const restoreView = useCallback(async (layout: SpatialLayoutSummary) => {
    try {
      const result = await loadLayout(layout.id)
      const card = result.layout.cards.find((item) => item.holo)
      if (!card || !card.holo) {
        setStatus(`"${layout.name}" was saved by Spatial Desktop, not by Holographic Projects. Choose a hologram layout instead.`)
        return
      }
      const holo = card.holo
      const listing = await listFolder(holo.root)
      // The root always shows its direct children, matching a freshly opened folder.
      const expandedPaths = new Set(holo.expanded)
      expandedPaths.add(holo.root)
      const restored = new Set([...expandedPaths].filter((path) => path !== holo.root))
      const nextChildren: Record<string, FileEntry[]> = { [holo.root]: listing.entries }
      let dropped = 0
      for (const path of Array.from(restored)) {
        try {
          const childListing = await listFolder(path)
          nextChildren[path] = childListing.entries
        } catch {
          restored.delete(path)
          dropped += 1
        }
      }
      setRootEntry(entryFromPath(holo.root))
      setChildrenByPath(nextChildren)
      setExpanded(expandedPaths)
      setFilterImages(holo.filterImages === true)
      setSelected(null)
      setPreview(null)
      setModel(null)
      historyRef.current = []
      setStatus(
        dropped > 0
          ? `Restored "${layout.name}" with ${dropped} folder(s) dropped because they are no longer readable. No file was changed.`
          : `Restored "${layout.name}" from saved JSON. No file was changed.`,
      )
      if (holo.camera) {
        const camera = holo.camera
        window.setTimeout(() => sceneApiRef.current?.setCamera(camera), 150)
      }
    } catch (caught) {
      pushToast('error', 'View was not restored', caught instanceof Error ? caught.message : undefined)
    }
  }, [])

  const holoState = useCallback(() => ({
    root: rootEntryRef.current?.path ?? null,
    expanded: Array.from(expandedRef.current),
  }), [])

  const control = useMemo<HoloControlApi>(() => {
    const findNode = (name: string) => {
      const wanted = name.trim().toLowerCase()
      return nodesRef.current.find((node) => node.name.toLowerCase() === wanted && !node.isMore) ?? null
    }
    return {
      expand(name) {
        const node = findNode(name)
        if (!node || node.type !== 'folder') {
          return { ok: false, reply: `No visible folder named "${name}". Expand a parent first. Nothing was changed.` }
        }
        if (expandedRef.current.has(node.path)) {
          return { ok: true, reply: `"${node.name}" is already expanded.` }
        }
        setExpanded((current) => new Set(current).add(node.path))
        if (!childrenByPath[node.path]) void ensureChildren(node.path)
        return { ok: true, reply: `Expanded "${node.name}". Read-only; no file was changed.` }
      },
      collapse(name) {
        if (!name) {
          if (expandedRef.current.size === 0) {
            return { ok: false, reply: 'No folder is expanded right now. Nothing was changed.' }
          }
          setExpanded(new Set())
          return { ok: true, reply: `Collapsed ${expandedRef.current.size} expanded folder(s). No file was changed.` }
        }
        const node = findNode(name)
        if (!node || node.type !== 'folder' || !expandedRef.current.has(node.path)) {
          return { ok: false, reply: `"${name}" is not an expanded visible folder. Nothing was changed.` }
        }
        setExpanded((current) => {
          const next = new Set(current)
          next.delete(node.path)
          return next
        })
        return { ok: true, reply: `Collapsed "${node.name}". No file was changed.` }
      },
      openNamed(name) {
        const node = findNode(name)
        if (!node) {
          return { ok: false, reply: `No visible item named "${name}". Nothing was opened.` }
        }
        if (node.type === 'folder') {
          void activateRoot(entryFromNode(node), { pushHistory: true })
          return { ok: true, reply: `Opening "${node.name}" as the centre of the scene. Read-only.` }
        }
        void openNode(node)
        return { ok: true, reply: `Opening "${node.name}". The action stays read-only or asks for approval.` }
      },
      back() {
        const handled = goBack()
        return {
          ok: handled,
          reply: handled ? 'Went up one level. No file was changed.' : 'Already at the top level of this allowed folder.',
        }
      },
      resetView() {
        sceneApiRef.current?.resetView()
        return { ok: Boolean(sceneApiRef.current), reply: 'Reset the camera to the home view.' }
      },
      filterImages(on) {
        setFilterImages(on)
        return {
          ok: true,
          reply: on ? 'Showing folders and images only in this scene.' : 'Showing every file kind again in this scene.',
        }
      },
      zoom(factor) {
        sceneApiRef.current?.zoom(factor)
        return {
          ok: Boolean(sceneApiRef.current),
          reply: factor > 1 ? 'Zoomed the hologram scene in.' : 'Zoomed the hologram scene out.',
        }
      },
      getState: holoState,
    }
  }, [activateRoot, childrenByPath, ensureChildren, goBack, holoState, openNode])

  useEffect(() => registerHoloControl(control), [control])

  const gestureText = gesturesEnabled
    ? [
        gestureStatus.gesture ? `Gesture: ${gestureStatus.gesture}` : 'Gestures: waiting for the shared gesture bus',
        hoveredNode ? `Node: ${hoveredNode.name}` : 'No node under the pointer',
      ].join(' · ')
    : 'Gestures off for this scene. Mouse and touch still work.'

  return (
    <section className="holo-workspace" aria-label="Holographic Projects workspace">
      <div className="holo-workspace__top">
        <div className="holo-roots" role="group" aria-label="Allowed folders">
          {rootsLoading ? (
            <span className="holo-muted"><Loader2 className="spin" /> Loading allowed folders…</span>
          ) : roots.length === 0 ? (
            <span className="holo-muted">No folders are allowed yet.</span>
          ) : (
            roots.map((root) => (
              <button
                key={root.path}
                type="button"
                className={rootEntry?.path === root.path ? 'is-active' : ''}
                title={root.path}
                onClick={() => { void activateRoot(entryFromRoot(root), { clearHistory: true }) }}
              >
                {root.label}
              </button>
            ))
          )}
        </div>
        <div className="holo-workspace__tools">
          <button type="button" className="ghost-action" onClick={() => goBack()} disabled={!rootEntry}>
            <ArrowLeft /> Back
          </button>
          <button type="button" className="ghost-action" onClick={() => { sceneApiRef.current?.resetView(); setStatus('Reset the camera (R).') }}>
            <RotateCcw /> Reset view <kbd>R</kbd>
          </button>
          <label className="holo-select">
            <span>Quality</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value as HoloQuality)} aria-label="Scene quality">
              {QUALITY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="holo-check">
            <input
              type="checkbox"
              checked={gesturesEnabled}
              onChange={(event) => setGesturesEnabled(event.target.checked)}
            />
            Gestures in this scene
          </label>
        </div>
      </div>

      {!granted ? (
        <div className="holo-gate">
          <h3><ShieldOff /> File access is off</h3>
          <p>
            Holographic Projects reuses the read-only allowed-folder API. It is off by default and there is no write,
            move, rename or delete endpoint. Grant file access, then allow a folder in Settings → File access.
          </p>
          <button type="button" className="primary-action" onClick={() => void grantAccess()} disabled={busy !== null}>
            {busy ? <Loader2 className="spin" /> : <ShieldCheck />} Grant file access for Holographic Projects
          </button>
        </div>
      ) : rootsLoading ? (
        <p className="holo-muted" role="status"><Loader2 className="spin" /> Loading the allowed folders…</p>
      ) : roots.length === 0 ? (
        <div className="holo-gate">
          <h3><FolderPlus /> No allowed folder yet</h3>
          <p>
            Nothing can be read until you allow a folder. Open <strong>Settings → File access</strong>, add an absolute
            path such as your test folder, then come back here.
          </p>
        </div>
      ) : model ? (
        <HoloModelViewer
          path={model.path}
          name={model.name}
          size={model.size}
          quality={quality}
          gesturesEnabled={gesturesEnabled}
          minConfidence={minConfidence}
          onClose={() => { setModel(null); setStatus('Closed the model view. The file is untouched.') }}
          onStatus={setStatus}
        />
      ) : rootEntry ? (
        <div className="holo-stage">
          <div className="holo-breadcrumb">
            <span>{baseName(rootEntry.path)}</span>
            <small>{rootEntry.path}</small>
            {rootIsAllowed && <em>allowed folder</em>}
            {pendingPaths.size > 0 && <span className="holo-muted"><Loader2 className="spin" /> reading {pendingPaths.size} folder(s)…</span>}
          </div>

          <HoloScene
            nodes={visibleNodes}
            selected={selectedKey}
            quality={quality}
            gesturesEnabled={gesturesEnabled}
            minConfidence={minConfidence}
            apiRef={sceneApiRef}
            onTap={handleTap}
            onHover={setHovered}
            onGesture={setGestureStatus}
          />

          <div className="holo-chip" role="status" aria-live="polite">
            <ScanEye aria-hidden="true" /> {gestureText}
            {hoveredNode && <small>{hoveredNode.path}</small>}
          </div>

          <div className="holo-legend" aria-hidden="true">
            {['folder', 'image', 'markdown', 'pdf', 'video', '3d', 'other'].map((kind) => (
              <span key={kind} data-kind={kind}>{kind}</span>
            ))}
          </div>

          <ul className="holo-sr-only" aria-label="Visible folder nodes">
            {visibleNodes.filter((node) => !node.isMore).map((node) => (
              <li key={node.key}>
                <button type="button" onClick={() => handleTap(node.key, 2)}>
                  {node.name} — {node.type === 'folder' ? 'folder' : node.kind}
                </button>
              </li>
            ))}
          </ul>

          {selectedNode && (
            <div className="holo-selected" role="status">
              <strong>{selectedNode.name}</strong>
              <span>{selectedNode.type === 'folder' ? 'folder' : selectedNode.kind}{selectedNode.type === 'file' ? ` · ${(selectedNode.size / 1024).toFixed(1)} KB` : ''}</span>
              <small>{selectedNode.path}</small>
              {selectedNode.blockedReason && <em>{selectedNode.blockedReason}</em>}
            </div>
          )}

          {truncated && (
            <p className="holo-notice" role="status">
              Only the first {MAX_VISIBLE_NODES} visible nodes are drawn. Collapse a folder or open a smaller one to see
              the rest of this tree.
            </p>
          )}
        </div>
      ) : (
        <p className="holo-muted">Choose an allowed folder above.</p>
      )}

      {rootEntry && granted && (
        <div className="holo-layouts">
          <h3><Layers /> Saved hologram views</h3>
          <div className="holo-layouts__save">
            <input
              value={layoutName}
              onChange={(event) => setLayoutName(event.target.value)}
              placeholder="Name this view — e.g. Engineering overview"
              aria-label="Hologram view name"
              onKeyDown={(event) => { if (event.key === 'Enter') void saveCurrentView() }}
            />
            <button type="button" className="primary-action" onClick={() => void saveCurrentView()} disabled={!layoutName.trim() || !rootEntry}>
              <Save /> Save view
            </button>
          </div>
          {layoutsLoading ? (
            <p className="holo-muted"><Loader2 className="spin" /> Loading saved layouts…</p>
          ) : layouts.length === 0 ? (
            <p className="holo-muted">No saved layouts yet. Saving stores JSON only; no file is touched.</p>
          ) : (
            <ul className="holo-layouts__list">
              {layouts.map((layout) => (
                <li key={layout.id}>
                  <span>
                    <strong>{layout.name}</strong>
                    <small>{layout.card_count} card(s) · updated {new Date(layout.updated_at).toLocaleString()}</small>
                  </span>
                  <button type="button" className="ghost-action" onClick={() => void restoreView(layout)}>Load</button>
                </li>
              ))}
            </ul>
          )}
          <p className="holo-note">
            Hologram views are stored with the existing Spatial Desktop layouts API as JSON. Loading a view never reads,
            touches or deletes a file outside the allowed folders.
          </p>
        </div>
      )}

      <div className="holo-status" role="status" aria-live="polite">
        <span>{status}</span>
        {error && <strong className="holo-error">{error}</strong>}
      </div>
      <p className="holo-note">
        Removing or hiding a node never deletes the file. Executables and scripts stay visible but are never opened.
        Every open request and folder search is written to the audit log. This is a 3D scene on the monitor, not a real
        hologram.
      </p>

      {preview && (
        <div className="holo-preview" role="dialog" aria-label={`Preview of ${preview.name}`}>
          <header>
            <h3>{preview.kind === 'image' ? <ImageIcon /> : <ScanEye />} {preview.name}</h3>
            <button type="button" className="icon-action" onClick={() => setPreview(null)} aria-label="Close preview"><X /></button>
          </header>
          {preview.preview_kind === 'image' && preview.thumbnail_url ? (
            <img src={thumbnailUrl(preview.path)} alt={`Preview of ${preview.name}`} />
          ) : preview.text ? (
            <pre>{preview.text}</pre>
          ) : (
            <p>{preview.reason ?? 'No inline preview is available for this file type.'}</p>
          )}
          {preview.truncated && <p className="holo-note">The preview is cut at the backend's preview limit.</p>}
          <footer>
            <span className="holo-muted">{preview.path}</span>
            <button type="button" className="primary-action" onClick={() => void requestSafeOpen(preview)} disabled={!preview.openable}>
              Open in another app
            </button>
          </footer>
        </div>
      )}

      {previewLoading && <p className="holo-muted" role="status"><Loader2 className="spin" /> Reading the preview…</p>}
      {previewError && <p className="holo-error" role="alert">{previewError}</p>}

      {pendingFolder && (
        <div className="holo-choices" role="dialog" aria-label="Choose a folder">
          <h3>Several folders match</h3>
          <p>{pendingFolder.note}</p>
          <ul>
            {pendingFolder.matches.map((match) => (
              <li key={match.path}>
                <button type="button" onClick={() => { void activateRoot(entryFromPath(match.path), { clearHistory: true }); setPendingFolder(null) }}>
                  <strong>{match.name}</strong>
                  <small>{match.path}</small>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost-action" onClick={() => { setPendingFolder(null); setStatus('Dismissed the choices. Nothing was opened.') }}>
            Cancel
          </button>
        </div>
      )}

      {openTask && (
        <>
          <p className="holo-open-note">This opens in another app. BOZZ cannot confirm what that app does afterwards.</p>
          <OpenApproval
            intent={openTask}
            busy={openBusy}
            error={openError}
            onApprove={() => void approve()}
            onCancel={() => void cancelApproval()}
            onClose={() => { setOpenTask(null); setOpenError(null) }}
          />
        </>
      )}
    </section>
  )
}
