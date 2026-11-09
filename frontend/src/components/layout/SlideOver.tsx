import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SlideOver({
  open,
  side,
  id,
  title,
  onClose,
  children,
  variant = 'default',
  compact = false,
  modal = true,
}: {
  open: boolean
  side: 'left' | 'right'
  id: string
  title: string
  onClose: () => void
  children: ReactNode
  variant?: 'default' | 'chat'
  compact?: boolean
  modal?: boolean
}) {
  const panelRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel || !modal) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // A side panel that must not block the orb closes on an outside click.
    const onPointerDown = (event: PointerEvent) => {
      if (modal) return
      const target = event.target as HTMLElement | null
      if (!target || panel?.contains(target)) return
      if (target.closest('[data-panel-keep-open]')) return
      onClose()
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    const previousOverflow = document.body.style.overflow
    if (modal) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus()
    }
  }, [open, onClose, modal])

  if (!open) return null

  const classes = ['slide-over', `slide-over--${side}`]
  if (variant !== 'default') classes.push(`slide-over--${variant}`)
  if (compact) classes.push('is-compact')

  return (
    <div className={`slide-over-layer${variant === 'chat' ? ' slide-over-layer--chat' : ''}`}>
      <div className="slide-over-scrim" onMouseDown={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        id={id}
        className={classes.join(' ')}
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        tabIndex={-1}
      >
        <div className="slide-over__head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
            <X />
          </button>
        </div>
        <div className="slide-over__body">{children}</div>
      </aside>
    </div>
  )
}
