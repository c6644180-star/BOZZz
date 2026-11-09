import { useRef } from 'react'
import { Keyboard, Mic } from 'lucide-react'

/**
 * The only control on the voice-first home screen: a round mic button and a
 * small keyboard button. A long press opens the text input instead of talking.
 */
export function HomeDock({
  listening,
  micAvailable,
  onMic,
  onType,
}: {
  listening: boolean
  micAvailable: boolean
  onMic: () => void
  onType: () => void
}) {
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  function startPress() {
    longPressed.current = false
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      longPressed.current = true
      onType()
    }, 500)
  }

  function endPress() {
    if (pressTimer.current === null) return
    window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  return (
    <div className="home-dock">
      <button
        type="button"
        className={`home-dock__mic${listening ? ' is-listening' : ''}`}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false
            return
          }
          onMic()
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        disabled={!micAvailable}
        aria-pressed={listening}
        aria-label={
          micAvailable
            ? listening
              ? 'Stop voice input'
              : 'Start voice input. Long-press to type instead.'
            : 'Voice input is unavailable in this browser'
        }
        title={micAvailable ? (listening ? 'Stop voice input' : 'Tap to talk · long-press to type') : 'Voice input is unavailable'}
      >
        <Mic />
      </button>
      <button
        type="button"
        className="home-dock__key"
        onClick={onType}
        aria-label="Type a message"
        title="Type a message (/)"
      >
        <Keyboard />
      </button>
    </div>
  )
}
