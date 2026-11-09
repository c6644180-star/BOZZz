import { useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { dismissToast, getToasts, subscribeToasts, type ToastTone } from '../../services/toast'

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts)

  return (
    <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone]
        return (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <Icon className="toast__icon" aria-hidden="true" />
            <div className="toast__copy">
              <strong>{toast.title}</strong>
              {toast.detail && <small>{toast.detail}</small>}
            </div>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismissToast(toast.id)}
              aria-label={`Dismiss ${toast.title}`}
            >
              <X />
            </button>
          </div>
        )
      })}
    </div>
  )
}
