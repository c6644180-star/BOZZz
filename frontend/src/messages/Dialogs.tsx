import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  confirmLabel: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div className="bci-modal-layer" onMouseDown={() => !busy && onCancel()}>
      <div
        className="bci-modal bci-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bci-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="bci-modal-head">
          <h2 id="bci-confirm-title"><AlertTriangle /> {title}</h2>
          <button type="button" className="icon-action" onClick={onCancel} disabled={busy} aria-label="Cancel">
            <X />
          </button>
        </header>
        <div className="bci-confirm-body">{children}</div>
        <footer className="bci-modal-actions">
          <div>
            <button type="button" className="ghost-action" onClick={onCancel} disabled={busy}>Cancel</button>
            <button
              ref={confirmRef}
              type="button"
              className={danger ? 'primary-action is-danger' : 'primary-action'}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <Loader2 /> : <AlertTriangle />} {confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
