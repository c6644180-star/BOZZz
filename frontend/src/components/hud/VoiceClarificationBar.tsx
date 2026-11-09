import { MessageCircleQuestion, X } from 'lucide-react'
import { useBozzVoice } from '../../hooks/useBozzVoice'

export function VoiceClarificationBar() {
  const { clarification, resolveClarification } = useBozzVoice()
  if (!clarification) return null
  return (
    <div className="voice-clarification" role="alertdialog" aria-label="Confirm the command" aria-live="assertive">
      <MessageCircleQuestion aria-hidden="true" />
      <div className="voice-clarification__copy">
        <strong>{clarification.prompt}</strong>
        <small>
          Recogniser confidence {Math.round(clarification.confidence * 100)}% ·{' '}
          {clarification.actionClass === 'consequential'
            ? 'consequential action — approval is still required after you confirm.'
            : 'safe action — confirming runs it once.'}
        </small>
      </div>
      <div className="voice-clarification__actions">
        <button type="button" className="hgi-btn hgi-btn--accent" onClick={() => resolveClarification(true)}>
          Yes, run it
        </button>
        <button type="button" className="hgi-btn" onClick={() => resolveClarification(false)}>
          <X /> No
        </button>
      </div>
    </div>
  )
}
