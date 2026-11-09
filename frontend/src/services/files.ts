import type { IntentView } from './intent'

export type FileKind = 'folder' | 'image' | 'markdown' | 'pdf' | 'text' | 'video' | '3d' | 'other'

export interface FileRoot {
  path: string
  label: string
  granted_at: string
}

export interface FileEntry {
  name: string
  path: string
  type: 'folder' | 'file'
  kind: FileKind
  size: number
  modified: string
  openable: boolean
  blocked_reason: string | null
}

export interface FilePreview extends FileEntry {
  preview_kind: FileKind | 'icon' | 'text' | 'image'
  text?: string
  truncated?: boolean
  preview_limit?: number
  thumbnail_url?: string
  reason?: string
}

export interface FolderListing {
  path: string
  name: string
  entries: FileEntry[]
  count: number
  truncated: boolean
}

export interface SearchResult {
  query: string
  kind: FileKind | null
  sort: 'recent' | 'name'
  count: number
  matches: FileEntry[]
  truncated: boolean
  cancelled: boolean
  cached: boolean
  roots: string[]
}

export interface FindTask extends IntentView {
  matches: FileEntry[]
  search: SearchResult | null
}

export interface HoloLayoutView {
  root: string
  expanded: string[]
  camera?: { position: [number, number, number]; target: [number, number, number] }
  filterImages?: boolean
}

export interface SpatialLayoutCard {
  id: string
  path: string
  name?: string
  x: number
  y: number
  w: number
  h: number
  z: number
  group?: string
  holo?: HoloLayoutView
}

export interface SpatialLayoutSummary {
  id: string
  name: string
  card_count: number
  created_at: string
  updated_at: string
}

export interface SpatialLayout extends SpatialLayoutSummary {
  cards: SpatialLayoutCard[]
}

export class SpatialApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SpatialApiError'
    this.status = status
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as { detail?: string }
  if (!response.ok) {
    throw new SpatialApiError(body.detail || `The Spatial Desktop request failed (${response.status}).`, response.status)
  }
  return body as T
}

export const listRoots = () =>
  requestJson<{ roots: FileRoot[]; permission_granted: boolean; holo_permission_granted: boolean }>('/api/files/roots')

export const addRoot = (path: string) =>
  requestJson<{ added: FileRoot; roots: FileRoot[] }>('/api/files/roots', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })

export const removeRoot = (path: string) =>
  requestJson<{ removed: boolean; roots: FileRoot[] }>(`/api/files/roots?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })

export const listFolder = (path: string, signal?: AbortSignal) =>
  requestJson<FolderListing>(`/api/files/list?path=${encodeURIComponent(path)}`, { signal })

export const searchFiles = (query: string, options: { limit?: number; kind?: FileKind; sort?: 'recent' | 'name'; signal?: AbortSignal } = {}) => {
  const params = new URLSearchParams({ q: query })
  if (options.limit) params.set('limit', String(options.limit))
  if (options.kind) params.set('kind', options.kind)
  if (options.sort) params.set('sort', options.sort)
  return requestJson<SearchResult>(`/api/files/search?${params.toString()}`, { signal: options.signal })
}

export const findFiles = (query: string, options: { limit?: number; kind?: FileKind; sort?: 'recent' | 'name'; label?: string } = {}) =>
  requestJson<FindTask>('/api/files/find', {
    method: 'POST',
    body: JSON.stringify({ query, ...options }),
  })

export const previewFile = (path: string, signal?: AbortSignal) =>
  requestJson<FilePreview>(`/api/files/preview?path=${encodeURIComponent(path)}`, { signal })

export const thumbnailUrl = (path: string) => `/api/files/thumbnail?path=${encodeURIComponent(path)}`

export const requestOpen = (path: string) =>
  requestJson<IntentView>('/api/files/open', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })

export const getOpenTask = (intentId: string) => requestJson<IntentView>(`/api/files/open/${intentId}`)

export const approveOpen = (intentId: string, approvalId: string) =>
  requestJson<IntentView>(`/api/files/open/${intentId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approval_id: approvalId, confirm: true }),
  })

export const listLayouts = () => requestJson<{ layouts: SpatialLayoutSummary[] }>('/api/spatial/layouts')

export const loadLayout = (id: string) =>
  requestJson<{ layout: SpatialLayout }>(`/api/spatial/layouts/${encodeURIComponent(id)}`)

export const saveLayout = (name: string, cards: SpatialLayoutCard[], id?: string) =>
  requestJson<{ layout: SpatialLayout }>('/api/spatial/layouts', {
    method: 'POST',
    body: JSON.stringify({ id, name, cards }),
  })

export const renameLayout = (id: string, name: string) =>
  requestJson<{ layout: SpatialLayout }>(`/api/spatial/layouts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })

export const deleteLayout = (id: string) =>
  requestJson<{ deleted: boolean; id: string }>(`/api/spatial/layouts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
