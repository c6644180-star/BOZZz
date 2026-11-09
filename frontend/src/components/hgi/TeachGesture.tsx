import { useRef, useState } from 'react'
import { Download, Pencil, Play, Save, Trash2, Upload, Wand2 } from 'lucide-react'
import { useHgi } from './hgiContext'
import {
  deleteTaughtGesture,
  exportTaughtGestures,
  importTaughtGestures,
  renameTaughtGesture,
  saveTaughtGesture,
} from '../../hgi/storage/gestureDb'
import { GESTURE_LABELS } from '../../hgi/classification/builtinGestures'

const RESERVED = new Set<string>(Object.keys(GESTURE_LABELS))

export function TeachGesture() {
  const {
    enabled,
    customGestures,
    metrics,
    settings,
    captureSamples,
    refreshCustomGestures,
  } = useHgi()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [samples, setSamples] = useState(0)
  const captureRef = useRef(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const currentGesture = metrics.currentGesture
  const live =
    currentGesture && currentGesture.startsWith('custom:')
      ? { name: currentGesture.slice('custom:'.length), confidence: metrics.gestureConfidence }
      : null

  async function record() {
    const clean = name.trim()
    if (!clean) {
      setMessage('Type a name for the gesture first.')
      return
    }
    if (clean.length > 32) {
      setMessage('Keep the name to 32 characters or fewer.')
      return
    }
    if (RESERVED.has(clean)) {
      setMessage('That name belongs to a built-in gesture. Choose a different name.')
      return
    }
    if (customGestures.some((gesture) => gesture.name.toLowerCase() === clean.toLowerCase())) {
      setMessage('A taught gesture with that name already exists. Rename the old one first.')
      return
    }
    if (!enabled) {
      setMessage('Start gestures first so the camera can collect landmark samples.')
      return
    }
    captureRef.current = true
    setBusy(true)
    setSamples(0)
    setMessage('Hold the pose in front of the camera for about 2.5 seconds…')
    try {
      const collected = await captureSamples(2800, 40)
      setSamples(collected.length)
      if (!captureRef.current) return
      if (collected.length < 5) {
        setMessage('Not enough samples — keep one hand clearly visible and try again.')
        return
      }
      await saveTaughtGesture({ name: clean, samples: collected, createdAt: Date.now() })
      await refreshCustomGestures()
      setName('')
      setMessage(`Saved “${clean}” with ${collected.length} feature samples (numbers only — no images).`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The gesture could not be saved.')
    } finally {
      captureRef.current = false
      setBusy(false)
    }
  }

  async function rename(gestureName: string) {
    const next = window.prompt(`Rename “${gestureName}” to:`, gestureName)
    if (!next || next.trim() === gestureName) return
    try {
      await renameTaughtGesture(gestureName, next)
      await refreshCustomGestures()
      setMessage(`Renamed to “${next.trim()}”.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Rename failed.')
    }
  }

  async function remove(gestureName: string) {
    if (!window.confirm(`Delete the taught gesture “${gestureName}”? This only removes the local sample set.`)) return
    try {
      await deleteTaughtGesture(gestureName)
      await refreshCustomGestures()
      setMessage(`Deleted “${gestureName}”.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Delete failed.')
    }
  }

  async function exportAll() {
    try {
      const json = await exportTaughtGestures()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'bozz-taught-gestures.json'
      link.click()
      URL.revokeObjectURL(url)
      setMessage('Exported taught gestures as JSON.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.')
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    try {
      const count = await importTaughtGestures(await file.text())
      await refreshCustomGestures()
      setMessage(`Imported ${count} taught gesture${count === 1 ? '' : 's'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const currentLabel = live ? live.name : null
  const confidence = live ? Math.round(live.confidence * 100) : 0
  const meetsGate = live ? live.confidence >= settings.minConfidence : false

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><Wand2 /> Teach a gesture</h3>
        <span className="hgi-chip">{customGestures.length} TAUGHT</span>
      </div>
      <p>
        Name a pose, hold it, and the engine records about 40 feature vectors — numbers such as finger extension,
        pinch ratio and speed. No images or video are saved.
      </p>
      <div className="hgi-field-row">
        <label className="hgi-field">
          <span>Gesture name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. phone hand"
            maxLength={32}
            disabled={busy}
          />
        </label>
        <button type="button" className="hgi-btn hgi-btn--accent" onClick={() => void record()} disabled={busy || !enabled}>
          <Play /> {busy ? `Recording… ${samples} samples` : 'Hold to record'}
        </button>
      </div>
      {busy && (
        <div className="hgi-progress">
          <span style={{ width: `${Math.min(100, (samples / 40) * 100).toFixed(1)}%` }} />
        </div>
      )}
      {message && <p className="hgi-message" role="status">{message}</p>}

      <div className="hgi-live-test">
        <strong>Live test</strong>
        <p>
          {currentLabel
            ? `${currentLabel} · ${confidence}% ${meetsGate ? '(above the command gate)' : `(below ${Math.round(settings.minConfidence * 100)}% — ignored)`}`
            : enabled
              ? 'Show a taught pose. Unrecognised or uncertain poses never fire a command.'
              : 'Start gestures to test a taught pose live.'}
        </p>
      </div>

      {customGestures.length > 0 ? (
        <ul className="hgi-gesture-list">
          {customGestures.map((gesture) => (
            <li key={gesture.name}>
              <div>
                <strong>{gesture.name}</strong>
                <small>{gesture.samples.length} samples · {new Date(gesture.createdAt).toLocaleDateString()}</small>
              </div>
              <div className="hgi-row-actions">
                <button type="button" className="hgi-icon-btn" onClick={() => void rename(gesture.name)} aria-label={`Rename ${gesture.name}`}><Pencil /></button>
                <button type="button" className="hgi-icon-btn is-danger" onClick={() => void remove(gesture.name)} aria-label={`Delete ${gesture.name}`}><Trash2 /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hgi-card__note">No taught gestures yet.</p>
      )}

      <div className="hgi-card__actions">
        <button type="button" className="hgi-btn" onClick={() => void exportAll()} disabled={customGestures.length === 0}>
          <Download /> Export JSON
        </button>
        <button type="button" className="hgi-btn" onClick={() => fileRef.current?.click()}>
          <Upload /> Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
        <span className="hgi-card__note"><Save /> Stored in IndexedDB on this device</span>
      </div>
      <p className="hgi-card__note">
        Built-in poses: {Object.values(GESTURE_LABELS).join(', ')}. A taught name can be bound to any action in Settings below.
      </p>
    </div>
  )
}
