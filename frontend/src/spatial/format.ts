import type { SpatialCard } from './controller'

export function formatBytes(size: number): string {
  if (!size) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function kindLabel(card: SpatialCard): string {
  if (card.type === 'folder') return 'Folder'
  return card.kind === 'other' ? 'File' : card.kind.toUpperCase()
}
