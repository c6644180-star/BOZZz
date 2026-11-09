import { useState } from 'react'
import { BellRing, Check, Phone, PhoneOff, ShieldOff, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ModulePage } from '../components/layout/ModulePage'
import { pushToast } from '../services/toast'

type SimulatedState = 'idle' | 'ringing' | 'accepted' | 'declined'

export default function CallsPage() {
  const [simulation, setSimulation] = useState(false)
  const [state, setState] = useState<SimulatedState>('idle')

  function toggleSimulation(enabled: boolean) {
    setSimulation(enabled)
    setState(enabled ? 'ringing' : 'idle')
    if (enabled) {
      pushToast(
        'warning',
        'Simulation: incoming call',
        'This is a local UI test. No call, microphone or network service is active.',
        7000,
      )
    }
  }

  return (
    <ModulePage
      title="BCCI Calls"
      subtitle="Call control is not connected. A clearly labelled simulation lets you test the incoming-call UI without a phone, microphone or network service."
      tone="preview"
    >
      <div className="placeholder-status">
        <span className="module-status status-not-connected"><ShieldOff /> Module status: Not connected</span>
        <p>
          There is no telephony transport in BOZZ. The simulation below only changes local page state and fires a local
          toast. It cannot receive, accept, decline or place a real call.
        </p>
      </div>

      <div className="workflow-grid call-grid">
        <section className="workflow-panel">
          <div className="workflow-panel-head">
            <h2><BellRing /> Simulation controls</h2>
            <span className="simulation-chip">SIMULATION</span>
          </div>
          <label className="toggle-row call-simulation-toggle">
            <span>
              Simulation mode
              <small>UI only. Clearly labelled everywhere. No microphone or network access.</small>
            </span>
            <input
              type="checkbox"
              checked={simulation}
              onChange={(event) => toggleSimulation(event.target.checked)}
            />
          </label>
          <p className="workflow-note">
            Turning this on immediately creates one fake incoming-call notification. You can replay it with the button
            below. Nothing is persisted after you leave this page.
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={!simulation}
            onClick={() => {
              setState('ringing')
              pushToast('warning', 'Simulation: incoming call', 'Replay of the local call-notification UI test.')
            }}
          >
            <BellRing /> Replay simulated call
          </button>
        </section>

        <section className="workflow-panel">
          <div className="workflow-panel-head">
            <h2><Phone /> Incoming call</h2>
            <span className="simulation-chip">SIMULATION</span>
          </div>

          {!simulation || state === 'idle' ? (
            <p className="workflow-note">Simulation is off. Turn it on to show the incoming-call card.</p>
          ) : (
            <article className={`simulated-call call-${state}`} aria-live="polite">
              <span className="simulation-banner"><TriangleAlert /> SIMULATED CALL — NOT REAL</span>
              <div className="simulated-call__avatar" aria-hidden="true"><Phone /></div>
              <h3>{state === 'ringing' ? 'Test Caller' : state === 'accepted' ? 'Simulation accepted' : 'Simulation declined'}</h3>
              <p>
                {state === 'ringing'
                  ? 'Incoming call preview · no audio path exists'
                  : state === 'accepted'
                    ? 'The UI recorded Accept locally. No call was connected.'
                    : 'The UI recorded Decline locally. Nothing was cancelled.'}
              </p>
              {state === 'ringing' && (
                <div className="simulated-call__actions">
                  <button type="button" className="primary-action" onClick={() => setState('accepted')}>
                    <Check /> Accept (simulation)
                  </button>
                  <button type="button" className="secondary-action" onClick={() => setState('declined')}>
                    <PhoneOff /> Decline (simulation)
                  </button>
                </div>
              )}
              {state !== 'ringing' && (
                <button type="button" className="secondary-action" onClick={() => setState('ringing')}>
                  <BellRing /> Show ringing again
                </button>
              )}
            </article>
          )}
        </section>
      </div>

      <p className="workflow-note">
        Module status and permissions: <Link to="/modules">open the Module Registry</Link>.
      </p>
    </ModulePage>
  )
}
