import { useRef, useState } from 'react'
import { ClipboardCheck, Play, Square, Trash2 } from 'lucide-react'
import { useHgi } from './hgiContext'
import { gestureBus } from '../../hgi/bus/GestureBus'
import { BUILTIN_GESTURES } from '../../hgi/types'
import type { GestureName, GestureTestResult, GestureTestTrial } from '../../hgi/types'
import { clearTestResults, loadTestResults, saveTestResult } from '../../hgi/storage/testResults'
import { GESTURE_LABELS } from '../../hgi/classification/builtinGestures'
import { gestureLabel } from '../../hgi/classification/builtinGestures'

const TRIALS = 20
const PROMPT_MS = 3000
const REST_MS = 1800

type Phase = 'idle' | 'prompt' | 'rest' | 'done'

export function GestureTestPanel() {
  const { enabled, settings, customGestures, toggleEnabled } = useHgi()
  const [target, setTarget] = useState<GestureName>('pinch')
  const [phase, setPhase] = useState<Phase>('idle')
  const [trial, setTrial] = useState(0)
  const [spotted, setSpotted] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<GestureTestResult | null>(null)
  const [results, setResults] = useState<GestureTestResult[]>(() => loadTestResults())
  const cancelRef = useRef(false)

  const options: GestureName[] = [
    ...BUILTIN_GESTURES,
    ...customGestures.map((gesture) => `custom:${gesture.name}` as GestureName),
  ]

  function waitWindow(kind: 'prompt' | 'rest'): Promise<{ hit: boolean; latencyMs: number | null }> {
    return new Promise((resolve) => {
      const startedAt = performance.now()
      let latency: number | null = null
      const unsubscribe = gestureBus.on('gesture.recognized', (payload) => {
        if (payload.name !== target) return
        if (payload.confidence < settings.minConfidence) return
        if (latency === null) {
          latency = performance.now() - startedAt
          if (kind === 'prompt') setSpotted(true)
        }
      })
      window.setTimeout(() => {
        unsubscribe()
        resolve({ hit: latency !== null, latencyMs: latency === null ? null : Math.round(latency) })
      }, kind === 'prompt' ? PROMPT_MS : REST_MS)
    })
  }

  async function run() {
    if (!enabled) {
      setMessage('Start gestures first — the test needs live recognition events.')
      return
    }
    cancelRef.current = false
    setRunning(true)
    setMessage(null)
    setLastResult(null)
    const trials: GestureTestTrial[] = []
    let hits = 0
    let falseTriggers = 0
    const latencies: number[] = []
    try {
      for (let index = 1; index <= TRIALS; index += 1) {
        if (cancelRef.current) break
        setTrial(index)
        setSpotted(false)
        setPhase('prompt')
        const prompt = await waitWindow('prompt')
        if (cancelRef.current) break
        setPhase('rest')
        const rest = await waitWindow('rest')
        if (prompt.hit) {
          hits += 1
          if (prompt.latencyMs !== null) latencies.push(prompt.latencyMs)
        }
        if (rest.hit) falseTriggers += 1
        trials.push({ target, hit: prompt.hit, latencyMs: prompt.latencyMs, falseTrigger: rest.hit })
      }
      if (cancelRef.current || trials.length < TRIALS) {
        setMessage('Test cancelled. Nothing was saved.')
        setPhase('idle')
        return
      }
      const avg = latencies.length > 0 ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null
      const result: GestureTestResult = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        createdAt: Date.now(),
        quality: settings.quality,
        minCutoff: settings.minCutoff,
        beta: settings.beta,
        perGesture: {
          [target]: {
            trials: TRIALS,
            hits,
            hitRate: Number((hits / TRIALS).toFixed(3)),
            falseTriggers,
            restWindows: TRIALS,
            falseTriggerRate: Number((falseTriggers / TRIALS).toFixed(3)),
            avgLatencyMs: avg,
          },
        },
        trials,
      }
      saveTestResult(result)
      setResults(loadTestResults())
      setLastResult(result)
      setPhase('done')
      setMessage(`Saved ${TRIALS} real trials for ${gestureLabel(target)}.`)
    } finally {
      setRunning(false)
    }
  }

  function cancel() {
    cancelRef.current = true
    setMessage('Cancelling after the current window…')
  }

  function clearHistory() {
    if (!window.confirm('Delete all locally saved gesture-test results?')) return
    clearTestResults()
    setResults([])
    setLastResult(null)
  }

  const entry = lastResult ? Object.entries(lastResult.perGesture)[0] : null

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><ClipboardCheck /> Gesture test</h3>
        <span className="hgi-chip">{TRIALS} REAL TRIALS</span>
      </div>
      <p>
        Pick one gesture, then perform it on cue for {PROMPT_MS / 1000} s, followed by a {REST_MS / 1000} s rest window.
        The hit rate, false-trigger rate and average prompt-to-event latency are measured from real recognition events,
        not simulated numbers.
      </p>

      <div className="hgi-field-row">
        <label className="hgi-field">
          <span>Gesture under test</span>
          <select value={target} onChange={(event) => setTarget(event.target.value as GestureName)} disabled={running}>
            {options.map((option) => (
              <option key={option} value={option}>{gestureLabel(option)}</option>
            ))}
          </select>
        </label>
        {!running ? (
          <button type="button" className="hgi-btn hgi-btn--accent" onClick={() => void run()} disabled={!enabled}>
            <Play /> Start {TRIALS}-trial test
          </button>
        ) : (
          <button type="button" className="hgi-btn hgi-btn--danger" onClick={cancel}>
            <Square /> Cancel
          </button>
        )}
      </div>

      {!enabled && (
        <p className="hgi-card__note">
          Gestures are off. <button type="button" className="hgi-inline-link" onClick={() => void toggleEnabled()}>Start gestures</button> to run the test.
        </p>
      )}

      {running && phase !== 'idle' && (
        <div className={`hgi-test ${phase === 'rest' ? 'is-rest' : ''}`} aria-live="polite">
          <p className="hgi-test__trial">Trial {trial} of {TRIALS}</p>
          <strong>{phase === 'prompt' ? `Show: ${gestureLabel(target)}` : 'Relax your hand'}</strong>
          <div className="hgi-test__bar" key={`${phase}-${trial}`} style={{ animationDuration: `${phase === 'prompt' ? PROMPT_MS : REST_MS}ms` }} />
          <p className="hgi-test__hint">
            {phase === 'prompt'
              ? spotted
                ? 'Recognised — hold until the window ends.'
                : 'Hold the pose. Uncertain recognition is ignored.'
              : 'False triggers are counted when the tested gesture fires while resting.'}
          </p>
        </div>
      )}

      {message && <p className="hgi-message" role="status">{message}</p>}

      {entry && lastResult && (
        <dl className="hgi-mini-stats hgi-mini-stats--wide">
          <div><dt>Hit rate</dt><dd>{Math.round(entry[1].hitRate * 100)}%</dd></div>
          <div><dt>False-trigger rate</dt><dd>{Math.round(entry[1].falseTriggerRate * 100)}%</dd></div>
          <div><dt>Avg latency</dt><dd>{entry[1].avgLatencyMs === null ? '—' : `${entry[1].avgLatencyMs} ms`}</dd></div>
          <div><dt>Trials</dt><dd>{entry[1].trials}</dd></div>
          <div><dt>Quality</dt><dd>{lastResult.quality}</dd></div>
          <div><dt>One Euro</dt><dd>{lastResult.minCutoff} / {lastResult.beta}</dd></div>
        </dl>
      )}

      <div className="hgi-card__head hgi-card__head--sub">
        <h4>Saved results</h4>
        {results.length > 0 && (
          <button type="button" className="hgi-btn" onClick={clearHistory}><Trash2 /> Clear</button>
        )}
      </div>
      {results.length === 0 ? (
        <p className="hgi-card__note">No saved results yet.</p>
      ) : (
        <ul className="hgi-result-list">
          {results.slice(0, 5).map((result) => (
            <li key={result.id}>
              <time dateTime={new Date(result.createdAt).toISOString()}>{new Date(result.createdAt).toLocaleString()}</time>
              <div>
                {Object.entries(result.perGesture).map(([name, value]) => (
                  <span key={name}>
                    <strong>{gestureLabel(name as GestureName)}</strong> · hit {Math.round(value.hitRate * 100)}% ·
                    false {Math.round(value.falseTriggerRate * 100)}% · {value.avgLatencyMs === null ? 'no hit' : `${value.avgLatencyMs} ms`}
                  </span>
                ))}
              </div>
              <small>{result.quality} · One Euro {result.minCutoff}/{result.beta}</small>
            </li>
          ))}
        </ul>
      )}
      <p className="hgi-card__note">
        Clap only scores above the command gate when the microphone gate hears a loud transient; without microphone
        permission it stays low-confidence by design. {GESTURE_LABELS.clap} is included for completeness.
      </p>
    </div>
  )
}
