import { useEffect, useRef, useState } from 'react'
import { useHgi } from './hgiContext'
import { gestureBus } from '../../hgi/bus/GestureBus'
import { loadAdaptiveSettings } from '../../adaptive/settings'

type FeedbackKind = 'press' | 'hold' | 'tap' | 'double' | 'rejected'

const COPY: Record<FeedbackKind, string> = {
  press: 'Pinching…',
  hold: 'Hold registered',
  tap: 'Tap',
  double: 'Double tap',
  rejected: 'Gesture rejected (uncertain)',
}

// Visual feedback for transition-based gestures. It never invents a state:
// every pill is driven by a real gesture-bus event.
export function GestureFeedbackOverlay() {
  const { enabled } = useHgi()
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; detail: string; at: number } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setFeedback(null)
      return
    }
    const settings = loadAdaptiveSettings().gestures
    const show = (kind: FeedbackKind, detail = '') => {
      setFeedback({ kind, detail, at: Date.now() })
      if (timer.current !== null) window.clearTimeout(timer.current)
      const life = kind === 'rejected' ? 2200 : kind === 'press' ? settings.enterMs + 400 : 900
      timer.current = window.setTimeout(() => setFeedback(null), life)
    }
    const offStart = gestureBus.on('gesture.pinch_start', (payload) => {
      show('press', `${Math.round(payload.confidence * 100)}% confidence`)
    })
    const offHold = gestureBus.on('gesture.pinch_hold', (payload) => {
      show('hold', `held ${Math.round(payload.heldMs)} ms`)
    })
    const offTap = gestureBus.on('gesture.tap', (payload) => show('tap', `${Math.round(payload.heldMs)} ms`))
    const offDouble = gestureBus.on('gesture.double_tap', (payload) => {
      show('double', payload.target ?? 'same target')
    })
    const offRejected = gestureBus.on('gesture.rejected', (payload) => show('rejected', payload.reason))
    return () => {
      offStart()
      offHold()
      offTap()
      offDouble()
      offRejected()
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [enabled])

  if (!enabled || !feedback) return null
  return (
    <div className={`hgi-feedback is-${feedback.kind}`} role="status" aria-live="polite">
      <span className="hgi-feedback__ring" aria-hidden="true" />
      <span className="hgi-feedback__copy">
        <strong>{COPY[feedback.kind]}</strong>
        {feedback.detail && <small>{feedback.detail}</small>}
      </span>
    </div>
  )
}
