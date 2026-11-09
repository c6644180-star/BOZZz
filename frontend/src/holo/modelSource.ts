export const HOLO_MODEL_EXTENSIONS = ['.glb', '.gltf'] as const

export function isHoloModel(path: string): boolean {
  const lowered = path.toLowerCase()
  return HOLO_MODEL_EXTENSIONS.some((extension) => lowered.endsWith(extension))
}

export function modelUrl(path: string): string {
  return `/api/files/model?path=${encodeURIComponent(path)}`
}

export function rawUrl(path: string): string {
  return `/api/files/raw?path=${encodeURIComponent(path)}`
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (index <= 0) return trimmed
  return trimmed.slice(0, index)
}

function isAbsolute(uri: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(uri)
}

/**
 * Resolve a glTF relative URI against the model file path. Returns null for
 * data/blob/http URIs and for paths that climb above the model folder. The
 * backend still enforces the allowed-folder rule on the actual read.
 */
export function resolveModelUri(baseFilePath: string, uri: string): string | null {
  const value = (uri || '').trim()
  if (!value) return null
  if (/^(?:data:|blob:|https?:)/i.test(value)) return null
  if (isAbsolute(value)) return value

  const separator = baseFilePath.includes('\\') ? '\\' : '/'
  const parts = dirname(baseFilePath).split(/[\\/]+/).filter(Boolean)
  const drive = /^[a-zA-Z]:$/.test(parts[0] ?? '') ? parts.shift() : undefined
  const floor = parts.length
  const segments = value.split(/[\\/]+/)
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length <= floor) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  const prefix = drive ? `${drive}${separator}` : /^[\\/]/.test(baseFilePath) ? separator : ''
  return `${prefix}${parts.join(separator)}`
}

export interface GltfSidecars {
  buffers: Array<{ uri: string; resolved: string }>
  images: Array<{ uri: string; resolved: string }>
}

interface GltfDocument {
  buffers?: Array<{ uri?: unknown }>
  images?: Array<{ uri?: unknown }>
}

export function findSidecars(document: GltfDocument, baseFilePath: string): GltfSidecars {
  const collect = (items: Array<{ uri?: unknown }> | undefined) => {
    const result: Array<{ uri: string; resolved: string }> = []
    for (const item of items ?? []) {
      if (typeof item?.uri !== 'string') continue
      const resolved = resolveModelUri(baseFilePath, item.uri)
      if (resolved) result.push({ uri: item.uri, resolved })
    }
    return result
  }
  return {
    buffers: collect(document.buffers),
    images: collect(document.images),
  }
}
