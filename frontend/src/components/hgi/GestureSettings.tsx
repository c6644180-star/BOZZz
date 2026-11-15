import { useSyncExternalStore } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useHgi } from './hgiContext'
import { BUILTIN_GESTURES, DEFAULT_HGI_SETTINGS } from '../../hgi/types'
import type { GestureName, HgiBindings, HgiQuality } from '../../hgi/types'
import { gestureLabel } from '../../hgi/classification/builtinGestures'
import { loadCursorAssist, saveCursorAssist, subscribeCursorAssist } from '../../hgi/cursorAssist'

const BINDING_COPY: Array<{ key: keyof HgiBindings; label: string; note: string }> = [
  { key: 'orbSpin', label: 'Orb spin', note: 'Pinch uses direct drag; other gestures use repeated recognition.' },
  { key: 'orbZoom', label: 'Orb zoom', note: 'Two-hand pinch is the direct spread/close binding.' },
  { key: 'orbPause', label: 'Orb pause', note: 'Hold for 1 s to pause or resume commands.' },
  { key: 'orbReset', label: 'Orb reset', note: 'Returns rotation and zoom to default.' },
  { key: 'cursorClick', label: 'Cursor click', note: 'Pinch = short click; pinch-hold drags.' },
  { key: 'cursorScroll', label: 'Cursor scroll', note: 'Vertical fingertip motion scrolls the page.' },
  { key: 'cursorPause', label: 'Cursor pause', note: 'Hold for 1 s to pause or resume.' },
  { key: 'desktopClick', label: 'Desktop click', note: 'Pinch = click; pinch-hold drags with the real mouse.' },
  { key: 'desktopDrag', label: 'Desktop drag', note: 'Pinch-hold is the safe default drag gesture.' },
  { key: 'desktopScroll', label: 'Desktop scroll', note: 'Sends scroll wheel events only.' },
]

const QUALITY_COPY: Record<HgiQuality, string> = {
  low: '320×240 · 12 fps — lightest',
  medium: '480×360 · 15 fps — balanced for i3',
  high: '640×480 · 20 fps — more detail, more CPU',
}

export function GestureSettings() {
  const { settings, updateSettings, customGestures, micAvailable, micDetail, micOptIn, setMicOptIn } = useHgi()

  const assist = useSyncExternalStore(subscribeCursorAssist, loadCursorAssist, loadCursorAssist)

  const gestures: GestureName[] = [
    ...BUILTIN_GESTURES,
    ...customGestures.map((gesture) => `custom:${gesture.name}` as GestureName),
  ]

  function setBinding(key: keyof HgiBindings, value: GestureName) {
    const bindings = { ...settings.bindings, [key]: value }
    updateSettings({ bindings })
  }

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><SlidersHorizontal /> Gesture settings</h3>
        <span className="hgi-chip">SAVED LOCALLY</span>
      </div>

      <div className="hgi-settings-grid">
        <label className="hgi-field">
          <span>Quality profile <small>{QUALITY_COPY[settings.quality]}</small></span>
          <select value={settings.quality} onChange={(event) => updateSettings({ quality: event.target.value as HgiQuality })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="hgi-field">
          <span>Minimum confidence <small>{Math.round(settings.minConfidence * 100)}% — uncertain poses never fire</small></span>
          <input
            type="range" min={0.3} max={0.95} step={0.01}
            value={settings.minConfidence}
            onChange={(event) => updateSettings({ minConfidence: Number(event.target.value) })}
          />
        </label>
        <label className="hgi-field">
          <span>One Euro min cutoff <small>{settings.minCutoff} Hz — lower is smoother</small></span>
          <input
            type="range" min={0.2} max={8} step={0.1}
            value={settings.minCutoff}
            onChange={(event) => updateSettings({ minCutoff: Number(event.target.value) })}
          />
        </label>
        <label className="hgi-field">
          <span>One Euro beta <small>{settings.beta} — higher reacts faster to speed</small></span>
          <input
            type="range" min={0} max={2} step={0.05}
            value={settings.beta}
            onChange={(event) => updateSettings({ beta: Number(event.target.value) })}
          />
        </label>
        <label className="hgi-field">
          <span>Pinch on threshold <small>{settings.pinchOn} — calibration sets this automatically</small></span>
          <input
            type="range" min={0.08} max={0.5} step={0.01}
            value={settings.pinchOn}
            onChange={(event) => updateSettings({ pinchOn: Number(event.target.value) })}
          />
        </label>
        <label className="hgi-field">
          <span>Pinch off threshold <small>{settings.pinchOff} — hysteresis prevents flicker</small></span>
          <input
            type="range" min={0.1} max={0.9} step={0.01}
            value={settings.pinchOff}
            onChange={(event) => updateSettings({ pinchOff: Number(event.target.value) })}
          />
        </label>
        <label className="toggle-row hgi-toggle">
          <span>
            Microphone loudness gate for clap
            <small>{micAvailable ? 'On — loudness only, no audio stored' : micDetail ?? 'Off — clap stays low-confidence'}</small>
          </span>
          <input
            type="checkbox"
            checked={micOptIn}
            onChange={(event) => {
              updateSettings({ micConfirmClap: event.target.checked })
              void setMicOptIn(event.target.checked)
            }}
          />
        </label>
      </div>

      <div className="hgi-card__head hgi-card__head--sub">
        <h4>Cursor assist</h4>
      </div>
      <div className="hgi-settings-grid">
        <label className="toggle-row hgi-toggle">
          <span>
            Snap to buttons
            <small>Gently pulls the cursor toward the nearest button or link so hand shake does not miss it.</small>
          </span>
          <input type="checkbox" checked={assist.snap} onChange={(event) => saveCursorAssist({ snap: event.target.checked })} />
        </label>
        <label className="hgi-field">
          <span>Snap strength zone <small>{assist.snapRadius}px — how close to a control before it pulls in</small></span>
          <input
            type="range" min={10} max={120} step={2}
            value={assist.snapRadius}
            disabled={!assist.snap}
            onChange={(event) => saveCursorAssist({ snapRadius: Number(event.target.value) })}
          />
        </label>
        <label className="toggle-row hgi-toggle">
          <span>
            Hover to click
            <small>Hold the cursor still on a control to click it, no pinch needed. It never clicks delete, send, approve or similar controls.</small>
          </span>
          <input type="checkbox" checked={assist.dwell} onChange={(event) => saveCursorAssist({ dwell: event.target.checked })} />
        </label>
        <label className="hgi-field">
          <span>Hover time <small>{(assist.dwellMs / 1000).toFixed(1)} s — longer means fewer accidental clicks</small></span>
          <input
            type="range" min={600} max={3000} step={100}
            value={assist.dwellMs}
            disabled={!assist.dwell}
            onChange={(event) => saveCursorAssist({ dwellMs: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="hgi-card__head hgi-card__head--sub">
        <h4>Gesture meanings</h4>
        <button
          type="button"
          className="hgi-btn"
          onClick={() => updateSettings({ bindings: { ...DEFAULT_HGI_SETTINGS.bindings } })}
        >
          <RotateCcw /> Restore defaults
        </button>
      </div>
      <div className="hgi-binding-grid">
        {BINDING_COPY.map((binding) => (
          <label key={binding.key} className="hgi-field">
            <span>{binding.label}<small>{binding.note}</small></span>
            <select value={settings.bindings[binding.key]} onChange={(event) => setBinding(binding.key, event.target.value as GestureName)}>
              {gestures.map((gesture) => (
                <option key={gesture} value={gesture}>{gestureLabel(gesture)}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="hgi-card__note">
        Keyboard shortcuts always work: G starts or stops gestures, M cycles Orb → Cursor → Desktop, R resets the orb,
        H opens history, P pauses output, and Esc closes panels and stops speech.
      </p>
    </div>
  )
}