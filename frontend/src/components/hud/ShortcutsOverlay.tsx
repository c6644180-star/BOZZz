import { useEffect, useRef } from 'react'
import { Keyboard } from 'lucide-react'

const SHORTCUTS = [
  { keys: ['H'], action: 'Open History (closes Chat)' },
  { keys: ['C'], action: 'Open or close the Chat panel' },
  { keys: ['N'], action: 'Show or hide the navigation dock' },
  { keys: ['/'], action: 'Focus the message input' },
  { keys: ['Type'], action: 'Any letter on the home screen opens the message input' },
  { keys: ['Esc'], action: 'Close the top panel or input, and stop speech' },
  { keys: ['?'], action: 'Show or hide this guide' },
  { keys: ['Ctrl', 'Alt', 'Q'], action: 'Emergency stop: camera, gestures, voice, and desktop control' },
  { keys: ['Ctrl', 'Alt', 'M'], action: 'Switch between the full window and the mini orb (desktop app)' },
  { keys: ['Ctrl', 'Shift', 'D'], action: 'Toggle Desktop Control on or off' },
  { keys: ['Space'], action: 'Hold for push-to-talk (configurable in Settings)' },
  { keys: ['Delete'], action: 'Spatial Desktop: remove a card (the file is untouched)' },
  { keys: ['Ctrl', 'Z'], action: 'Spatial Desktop: restore the last removed card' },
  { keys: ['R'], action: 'Holographic Projects: reset the camera to the home view' },
  { keys: ['Esc'], action: 'Holographic Projects: close a preview/model or go up one folder level' },
  { keys: ['Click', 'Click'], action: 'Holographic Projects: single click expands a folder, double click opens it' },
]

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    cardRef.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="shortcuts-layer" onMouseDown={onClose}>
      <div
        ref={cardRef}
        className="shortcuts-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="shortcuts-title">
            <Keyboard aria-hidden="true" />
            Keyboard shortcuts
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close keyboard shortcuts">
            Esc
          </button>
        </header>
        <ul>
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.action}>
              <span className="shortcut-keys">
                {shortcut.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
              <span>{shortcut.action}</span>
            </li>
          ))}
        </ul>
        <p>Shortcuts are ignored while you are typing in a text field.</p>
      </div>
    </div>
  )
}
