import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react'
import type { IntentView } from '../services/intent'

export function OpenApproval({
  intent,
  busy,
  error,
  onApprove,
  onCancel,
  onClose,
}: {
  intent: IntentView
  busy: boolean
  error: string | null
  onApprove: () => void
  onCancel: () => void
  onClose: () => void
}) {
  const finished = intent.status === 'reported' || intent.status === 'failed'
  const action = intent.actions[0]
  return (
    <div className="spatial-modal-layer" onMouseDown={onClose}>
      <div
        className="spatial-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spatial-approval-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="spatial-approval-title">
            {finished ? <CheckCircle2 /> : <ShieldCheck />}
            {finished ? 'Open result' : 'Approve opening a file'}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>

        {finished ? (
          <>
            <p className={intent.status === 'reported' ? 'spatial-modal__ok' : 'spatial-modal__error'}>
              {intent.message}
            </p>
            {intent.verification_evidence.map((item) => (
              <p key={item.detail} className="spatial-modal__evidence">
                {item.ok ? <CheckCircle2 /> : <AlertTriangle />} {item.detail}
                <small>Source: {item.source ?? 'unknown'}</small>
              </p>
            ))}
            <p className="spatial-modal__note">
              BOZZ can confirm the file exists and that the OS accepted the request. It cannot confirm what the
              application does afterwards.
            </p>
          </>
        ) : (
          <>
            <p>
              {action?.description ?? 'Ask the operating system to open this file with its default application.'}
            </p>
            <p className="spatial-modal__path">{action?.target}</p>
            {intent.warnings.map((warning) => (
              <p key={warning} className="spatial-modal__warning"><AlertTriangle /> {warning}</p>
            ))}
            <p className="spatial-modal__note">
              This is a real Intent Map task. It is recorded in the audit log and appears on the Intent Map page.
            </p>
            {error && <p className="spatial-modal__error" role="alert"><AlertTriangle /> {error}</p>}
          </>
        )}

        <footer>
          {finished ? (
            <button type="button" className="primary-action" onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" className="ghost-action" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="primary-action" onClick={onApprove} disabled={busy}>
                {busy ? <Loader2 /> : <ExternalLink />} Approve and open
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
