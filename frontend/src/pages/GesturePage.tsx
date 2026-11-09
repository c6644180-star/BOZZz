import { Hand, Pause, Play, Power, RotateCcw } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'
import { useHgi } from '../components/hgi/hgiContext'
import { CameraPreview } from '../components/hgi/CameraPreview'
import { DiagnosticsPanel } from '../components/hgi/DiagnosticsPanel'
import { CalibrationWizard } from '../components/hgi/CalibrationWizard'
import { TeachGesture } from '../components/hgi/TeachGesture'
import { GestureTestPanel } from '../components/hgi/GestureTestPanel'
import { AdaptiveGesturePanel } from '../components/hgi/AdaptiveGesturePanel'
import { SessionRecorder } from '../components/hgi/SessionRecorder'
import { GestureSettings } from '../components/hgi/GestureSettings'
import { DesktopControlPanel } from '../components/hgi/DesktopControlPanel'

const MODES = [
  { id: 'orb', label: 'Orb', copy: 'Pinch-drag spins the command-center orb; two pinched hands zoom.' },
  { id: 'cursor', label: 'Cursor', copy: 'An in-page pointer follows your fingertip; pinch clicks safely.' },
  { id: 'desktop', label: 'Desktop', copy: 'Sends real mouse move, click, drag, scroll to the local backend.' },
] as const

export default function GesturePage() {
  const {
    enabled,
    starting,
    mode,
    paused,
    error,
    metrics,
    toggleEnabled,
    setMode,
    togglePause,
    resetOrb,
  } = useHgi()

  return (
    <ModulePage
      title="Gesture Lab"
      subtitle="Local hand tracking with one shared event bus, honest diagnostics, calibration, teachable gestures, and a mouse-only desktop adapter."
      tone="live"
    >
      <div className="hgi-toolbar">
        <div className={`hgi-toolbar__state ${enabled ? 'is-live' : ''}`}>
          <span className={`hgi-live-dot ${metrics.cameraActive ? 'is-live' : starting ? 'is-waiting' : ''}`} />
          <div>
            <strong>{starting ? 'Starting camera…' : enabled ? 'Engine running' : 'Engine off'}</strong>
            <small>
              {enabled
                ? `${metrics.fps} fps · ${metrics.hands} hand${metrics.hands === 1 ? '' : 's'} · ${metrics.latencyMs} ms`
                : 'The camera stays released until you start gestures.'}
            </small>
          </div>
        </div>
        <div className="hgi-toolbar__actions">
          <button type="button" className={`hgi-btn ${enabled ? '' : 'hgi-btn--accent'}`} onClick={() => void toggleEnabled()}>
            {enabled ? <Power /> : <Hand />}
            {enabled ? 'Stop gestures & camera' : starting ? 'Starting…' : 'Start gestures'}
          </button>
          <button type="button" className="hgi-btn" onClick={togglePause} disabled={!enabled}>
            {paused ? <Play /> : <Pause />} {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="hgi-btn" onClick={resetOrb} disabled={!enabled}>
            <RotateCcw /> Reset orb
          </button>
        </div>
      </div>
      {error && <p className="hgi-error" role="alert">{error}</p>}

      <div className="hgi-mode-cards">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`hgi-mode-card ${mode === item.id ? 'is-active' : ''}`}
            onClick={() => setMode(item.id)}
            aria-pressed={mode === item.id}
          >
            <strong>{item.label}</strong>
            <span>{item.copy}</span>
            {item.id === 'desktop' && <em>Requires the local backend and Desktop Control ON</em>}
          </button>
        ))}
      </div>

      <div className="hgi-grid hgi-grid--two">
        <CameraPreview />
        <DiagnosticsPanel />
      </div>

      <div className="hgi-grid hgi-grid--two">
        <CalibrationWizard />
        <TeachGesture />
      </div>

      <div className="hgi-grid hgi-grid--two">
        <GestureTestPanel />
        <AdaptiveGesturePanel />
      </div>

      <div className="hgi-grid hgi-grid--two">
        <SessionRecorder />
        <GestureSettings />
      </div>

      <div className="hgi-grid hgi-grid--two">
        <DesktopControlPanel />
      </div>

      <div className="hgi-card hgi-card--wide">
        <h3><Hand /> First run, in order</h3>
        <ol className="hgi-phases">
          <li><strong>Start gestures</strong><span>Allow the camera. A green CAMERA ACTIVE dot appears in the HUD; Off releases it immediately.</span></li>
          <li><strong>Calibrate</strong><span>Hold open palm, pinch, fist, and relaxed. Your thresholds are saved locally.</span></li>
          <li><strong>Try Orb mode</strong><span>Pinch and move to spin. Pinch with both hands and spread to zoom. Flick to reset.</span></li>
          <li><strong>Measure</strong><span>Run the 20-trial test for a real hit rate, false-trigger rate, and average latency.</span></li>
          <li><strong>Desktop (optional)</strong><span>Start the backend, open Notepad, turn Desktop Control ON, and keep Emergency Stop within reach.</span></li>
        </ol>
        <p className="hgi-card__note">
          Keys: G gestures on/off · M cycle mode · R reset orb · H history · P pause output · Esc close panels and stop speech.
        </p>
      </div>
    </ModulePage>
  )
}
