import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Box,
  ExternalLink,
  File,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Loader2,
  Lock,
  X,
} from 'lucide-react'
import { SpatialApiError, type FilePreview } from '../services/files'
import type { SpatialCard, SpatialController } from './controller'
import { formatBytes, kindLabel } from './format'
import { loadPreview } from './previews'

const ICONS = {
  folder: Folder,
  image: ImageIcon,
  markdown: FileText,
  pdf: FileText,
  text: FileText,
  video: Film,
  '3d': Box,
  other: File,
} as const

function CardPreview({ card, controller }: { card: SpatialCard; controller: SpatialController }) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(card.type !== 'folder')

  useEffect(() => {
    if (card.type === 'folder') return
    const abort = new AbortController()
    loadPreview(card.path, abort.signal).then(
      (result) => {
        if (abort.signal.aborted) return
        setPreview(result)
        setLoading(false)
        controller.updateMeta(card.id, {
          kind: result.kind,
          size: result.size,
          modified: result.modified,
          openable: result.openable,
          blockedReason: result.blocked_reason,
          type: result.type,
          missing: false,
          missingReason: undefined,
        })
      },
      (caught: unknown) => {
        if (abort.signal.aborted) return
        setLoading(false)
        if (caught instanceof SpatialApiError && caught.status === 404) {
          setError('File missing')
          controller.setMissing(card.id, true, caught.message)
          return
        }
        setError(caught instanceof Error ? caught.message : 'Preview unavailable')
      },
    )
    return () => abort.abort()
  }, [card.id, card.path, card.type, controller])

  if (card.type === 'folder') {
    return (
      <div className="spatial-card__folder">
        <Folder />
        <span>Double-click to browse</span>
      </div>
    )
  }

  if (card.missing) {
    return (
      <div className="spatial-card__missing" role="alert">
        <Lock />
        <strong>File missing</strong>
        <small>{card.missingReason || 'This path no longer exists or is not readable.'}</small>
      </div>
    )
  }

  if (loading) {
    return <div className="spatial-card__loading" role="status"><Loader2 /> Loading preview…</div>
  }

  if (error) {
    return <div className="spatial-card__error">{error}</div>
  }

  if (preview?.preview_kind === 'image' && preview.thumbnail_url) {
    return <img className="spatial-card__image" src={preview.thumbnail_url} alt={card.name} loading="lazy" draggable={false} />
  }

  if (preview?.preview_kind === 'text' && preview.text) {
    return (
      <div className="spatial-card__text">
        <pre>{preview.text.slice(0, 320)}</pre>
        {preview.truncated && <small>First 4 KB shown</small>}
      </div>
    )
  }

  const Icon = ICONS[card.kind] ?? File
  return (
    <div className="spatial-card__icon">
      <Icon />
      <span>{preview?.reason || 'No preview is available for this file type.'}</span>
    </div>
  )
}

export function SpatialCardView({
  card,
  selected,
  controller,
  onCardPointerDown,
  onHeaderPointerDown,
  onResizePointerDown,
  onOpen,
  onDismiss,
}: {
  card: SpatialCard
  selected: boolean
  controller: SpatialController
  onCardPointerDown: (event: ReactPointerEvent<HTMLElement>, card: SpatialCard) => void
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>, card: SpatialCard) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, card: SpatialCard) => void
  onOpen: (card: SpatialCard) => void
  onDismiss: (card: SpatialCard) => void
}) {
  const Icon = ICONS[card.kind] ?? File
  const blocked = card.type === 'file' && !card.openable

  return (
    <article
      className={`spatial-card${selected ? ' is-selected' : ''}${card.missing ? ' is-missing' : ''}`}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h, zIndex: card.z }}
      role="group"
      tabIndex={0}
      aria-label={`${card.name}, ${kindLabel(card)}${selected ? ', selected' : ''}`}
      onPointerDown={(event) => onCardPointerDown(event, card)}
      onDoubleClick={() => onOpen(card)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(card)
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          controller.move(card.id, card.x - 10, card.y)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          controller.move(card.id, card.x + 10, card.y)
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          controller.move(card.id, card.x, card.y - 10)
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          controller.move(card.id, card.x, card.y + 10)
        }
      }}
    >
      <header className="spatial-card__head" onPointerDown={(event) => onHeaderPointerDown(event, card)}>
        <Icon aria-hidden="true" />
        <strong title={card.path}>{card.name}</strong>
        <div className="spatial-card__actions">
          <button
            type="button"
            className="icon-action"
            onClick={(event) => {
              event.stopPropagation()
              onOpen(card)
            }}
            aria-label={`Open ${card.name}`}
            title={blocked ? card.blockedReason || 'This file cannot be opened.' : 'Open'}
            disabled={blocked}
          >
            {blocked ? <Lock /> : <ExternalLink />}
          </button>
          <button
            type="button"
            className="icon-action"
            onClick={(event) => {
              event.stopPropagation()
              onDismiss(card)
            }}
            aria-label={`Remove ${card.name} from the workspace`}
            title="Remove card (the file is untouched)"
          >
            <X />
          </button>
        </div>
      </header>
      {card.group && <span className="spatial-card__group">{card.group}</span>}
      <div className="spatial-card__body">
        <CardPreview key={card.path} card={card} controller={controller} />
      </div>
      <footer className="spatial-card__foot">
        <span>{kindLabel(card)}</span>
        <span>{card.type === 'folder' ? 'folder' : formatBytes(card.size)}</span>
        {blocked && <span className="spatial-card__blocked">Blocked</span>}
      </footer>
      <span
        className="spatial-card__resize"
        role="presentation"
        onPointerDown={(event) => onResizePointerDown(event, card)}
      />
    </article>
  )
}
