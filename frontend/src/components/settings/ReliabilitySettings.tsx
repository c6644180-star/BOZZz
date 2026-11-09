import { useState } from 'react'
import { Link } from 'react-router-dom'
import { resetAdaptiveSettings, loadAdaptiveSettings, updateAdaptiveSettings } from '../../adaptive/settings'
import type { AdaptiveSettings } from '../../adaptive/types'

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function ReliabilitySettings() {
  const [adaptive, setAdaptive] = useState<AdaptiveSettings>(() => loadAdaptiveSettings())

  function patch(next: Partial<AdaptiveSettings>) {
    setAdaptive(updateAdaptiveSettings(next))
  }

  function patchGestures(next: Partial<AdaptiveSettings['gestures']>) {
    patch({ gestures: { ...adaptive.gestures, ...next } })
  }

  function patchVoice(next: Partial<AdaptiveSettings['voice']>) {
    patch({ voice: { ...adaptive.voice, ...next } })
  }

  return (
    <section className="settings-group" aria-label="Reliability">
      <h3>Reliability</h3>
      <p className="settings-note">
        Every confidence score on this device is measured from live signals. Thresholds decide when an action
        runs, asks first, or is rejected. Gestures and voice below use these values immediately.
      </p>

      <label className="select-row">
        <span>
          Safe actions run above
          <small>Opening a panel, navigating, pointing at a part. Below this the action is rejected.</small>
        </span>
        <input
          type="range"
          min={20}
          max={90}
          step={1}
          value={Math.round(adaptive.thresholds.safe * 100)}
          onChange={(event) => patch({ thresholds: { ...adaptive.thresholds, safe: Number(event.target.value) / 100 } })}
          aria-valuetext={percent(adaptive.thresholds.safe)}
        />
      </label>

      <label className="select-row">
        <span>
          Consequential actions run above
          <small>Desktop clicks, typing, approvals. Kept above the safe threshold on purpose.</small>
        </span>
        <input
          type="range"
          min={40}
          max={99}
          step={1}
          value={Math.round(adaptive.thresholds.consequential * 100)}
          onChange={(event) => patch({ thresholds: { ...adaptive.thresholds, consequential: Number(event.target.value) / 100 } })}
          aria-valuetext={percent(adaptive.thresholds.consequential)}
        />
      </label>

      <div className="reliability-number-row">
        <span>
          Pinch enter (ms)
          <small>How long the fingers must stay together before an action fires.</small>
        </span>
        <input
          type="number"
          min={0}
          max={400}
          step={10}
          value={adaptive.gestures.enterMs}
          onChange={(event) => patchGestures({ enterMs: Number(event.target.value) })}
        />
      </div>
      <div className="reliability-number-row">
        <span>
          Hold (ms)
          <small>Pinch duration for a hold action. Shorter pinches become taps.</small>
        </span>
        <input
          type="number"
          min={40}
          max={600}
          step={10}
          value={adaptive.gestures.holdMs}
          onChange={(event) => patchGestures({ holdMs: Number(event.target.value) })}
        />
      </div>
      <div className="reliability-number-row">
        <span>
          Tap maximum (ms)
          <small>Pinches shorter than this count as taps; two within the window are a double tap.</small>
        </span>
        <input
          type="number"
          min={80}
          max={600}
          step={10}
          value={adaptive.gestures.tapMaxMs}
          onChange={(event) => patchGestures({ tapMaxMs: Number(event.target.value) })}
        />
      </div>
      <div className="reliability-number-row">
        <span>
          Stable frames
          <small>Consecutive frames before a gesture is trusted. Higher is stricter.</small>
        </span>
        <input
          type="number"
          min={1}
          max={10}
          step={1}
          value={adaptive.gestures.stableFrames}
          onChange={(event) => patchGestures({ stableFrames: Number(event.target.value) })}
        />
      </div>

      <label className="toggle-row">
        <span>
          Left hand gestures
          <small>Disable to ignore the left hand completely.</small>
        </span>
        <input
          type="checkbox"
          checked={adaptive.gestures.left.enabled}
          onChange={(event) => patchGestures({ left: { ...adaptive.gestures.left, enabled: event.target.checked } })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Right hand gestures
          <small>Thresholds are stored separately per hand.</small>
        </span>
        <input
          type="checkbox"
          checked={adaptive.gestures.right.enabled}
          onChange={(event) => patchGestures({ right: { ...adaptive.gestures.right, enabled: event.target.checked } })}
        />
      </label>

      <div className="reliability-number-row">
        <span>
          Suspend wake word above CPU load
          <small>Main-thread load measured over {adaptive.voice.cpuSuspendSeconds} s. Wake word only.</small>
        </span>
        <input
          type="number"
          min={30}
          max={100}
          step={5}
          value={adaptive.voice.cpuSuspendPercent}
          onChange={(event) => patchVoice({ cpuSuspendPercent: Number(event.target.value) })}
        />
      </div>

      <label className="toggle-row">
        <span>
          Analyse 3D models automatically
          <small>Runs locally in a worker. Large files ask first.</small>
        </span>
        <input
          type="checkbox"
          checked={adaptive.models.autoAnalyze}
          onChange={(event) => patch({ models: { ...adaptive.models, autoAnalyze: event.target.checked } })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Confirm before Ask AI sees model data
          <small>Only a compact JSON summary leaves the device, and only after your confirmation.</small>
        </span>
        <input
          type="checkbox"
          checked={adaptive.models.confirmBeforeAskAI}
          onChange={(event) => patch({ models: { ...adaptive.models, confirmBeforeAskAI: event.target.checked } })}
        />
      </label>

      <p>
        <Link to="/reliability" className="secondary-action">Open Reliability report</Link>{' '}
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAdaptive(resetAdaptiveSettings())}
        >
          Reset reliability settings
        </button>
      </p>
    </section>
  )
}
