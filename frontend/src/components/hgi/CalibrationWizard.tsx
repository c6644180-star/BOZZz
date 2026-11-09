import { Gauge, Play, Trash2 } from 'lucide-react'
import { useHgi } from './hgiContext'
import { CALIBRATION_PHASES } from '../../hgi/types'
import type { CalibrationPhase } from '../../hgi/types'

const PHASE_COPY: Record<CalibrationPhase, { title: string; body: string }> = {
  open_palm: { title: 'Open palm', body: 'Hold your hand open, fingers spread, facing the camera.' },
  pinch: { title: 'Pinch', body: 'Touch thumb and index fingertip together without squeezing.' },
  fist: { title: 'Fist', body: 'Close your hand into a comfortable fist.' },
  relaxed: { title: 'Relaxed', body: 'Let your hand hang naturally with slightly curved fingers.' },
}

export function CalibrationWizard() {
  const {
    enabled,
    calibration,
    calibrationUpdate,
    startCalibration,
    cancelCalibration,
    clearCalibrationProfile,
  } = useHgi()

  const running = calibrationUpdate !== null && !calibrationUpdate.done
  const phase = calibrationUpdate?.phase ?? 'open_palm'
  const copy = PHASE_COPY[phase]

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><Gauge /> Calibration</h3>
        <span className="hgi-chip">{calibration ? 'PERSONAL PROFILE SAVED' : 'DEFAULTS'}</span>
      </div>

      {running && calibrationUpdate ? (
        <div className="hgi-calibration" aria-live="polite">
          <p className="hgi-calibration__step">
            Step {calibrationUpdate.phaseIndex + 1} of {CALIBRATION_PHASES.length} — {copy.title}
          </p>
          <p>{copy.body}</p>
          <div className="hgi-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(calibrationUpdate.totalProgress * 100)}>
            <span style={{ width: `${(calibrationUpdate.totalProgress * 100).toFixed(1)}%` }} />
          </div>
          <p className="hgi-calibration__meta">
            {calibrationUpdate.waiting
              ? 'Waiting for a hand — time is paused until one is visible.'
              : `${calibrationUpdate.samples} samples this step · ${Math.round(calibrationUpdate.phaseProgress * 100)}% of step`}
          </p>
          <button type="button" className="hgi-btn" onClick={cancelCalibration}>Cancel calibration</button>
        </div>
      ) : (
        <>
          <p>
            About 10 seconds, four poses, all on this device. Calibration only learns your pinch distance and the
            three main hand shapes; it does not store images or video.
          </p>
          <ol className="hgi-phases">
            {CALIBRATION_PHASES.map((item) => (
              <li key={item}>
                <strong>{PHASE_COPY[item].title}</strong>
                <span>{PHASE_COPY[item].body}</span>
              </li>
            ))}
          </ol>
          {calibration && (
            <dl className="hgi-mini-stats">
              <div><dt>Pinch on</dt><dd>{calibration.pinchOn}</dd></div>
              <div><dt>Pinch off</dt><dd>{calibration.pinchOff}</dd></div>
              <div><dt>Saved</dt><dd>{new Date(calibration.createdAt).toLocaleString()}</dd></div>
              <div><dt>Samples</dt><dd>{Object.values(calibration.sampleCounts).reduce((sum, value) => sum + value, 0)}</dd></div>
            </dl>
          )}
          <div className="hgi-card__actions">
            <button type="button" className="hgi-btn hgi-btn--accent" onClick={startCalibration} disabled={!enabled}>
              <Play /> {calibration ? 'Recalibrate' : 'Start calibration'}
            </button>
            {calibration && (
              <button type="button" className="hgi-btn" onClick={clearCalibrationProfile}>
                <Trash2 /> Clear profile
              </button>
            )}
          </div>
          {!enabled && <p className="hgi-card__note">Start gestures first — calibration needs live landmarks.</p>}
        </>
      )}
    </div>
  )
}
