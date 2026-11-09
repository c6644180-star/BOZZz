import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle2, Gauge, Play, Square, Sun, Timer } from 'lucide-react'
import { useHgi } from './hgiContext'
import { gestureBus } from '../../hgi/bus/GestureBus'
import { loadAdaptiveSettings, updateAdaptiveSettings } from '../../adaptive/settings'
import { proposeTuning } from '../../adaptive/tuning'
import type { TuningProposal, TuningSamples } from '../../adaptive/tuning'
import { classifyLighting, landmarkCoverage, measureFrameLighting } from '../../adaptive/lighting'
import type { LightingVerdict } from '../../adaptive/lighting'
import {
  GESTURE_SUITE_TARGETS,
  GESTURE_TARGET_COPY,
  evaluateGestureSuite,
  latestGestureSuite,
  saveGestureSuite,
  summarizeGestureSuite,
} from '../../adaptive/benchmarks'
import type { GestureSuiteResult, GestureSuiteTarget, GestureSuiteTrial } from '../../adaptive/benchmarks'
import type { HandLandmarks } from '../../hgi/types'

const WIZARD_MS = 60_000
const TRIALS_PER_GESTURE = 3
const PROMPT_MS = 3000
const REST_MS = 1500

type WizardPhase = 'pinches' | 'open' | 'taps' | 'review'

function wizardPhase(elapsedMs: number): WizardPhase {
  if (elapsedMs < 20_000) return 'pinches'
  if (elapsedMs < 35_000) return 'open'
  if (elapsedMs < WIZARD_MS) return 'taps'
  return 'review'
}

const PHASE_COPY: Record<Exclude<WizardPhase, 'review'>, string> = {
  pinches: 'Pinch your thumb and index finger, hold for a moment, then release. Repeat slowly.',
  open: 'Open your hand flat and relax it in front of the camera. Keep it fully visible.',
  taps: 'Make quick, light taps (a short pinch and immediate release). Repeat about once a second.',
}

function suiteEvent(target: GestureSuiteTarget): {
  event: 'pinch_start' | 'tap' | 'double_tap' | 'pinch_hold' | 'recognized'
  name?: 'point' | 'flick' | 'open_palm'
} {
  if (target === 'pinch') return { event: 'pinch_start' }
  if (target === 'tap') return { event: 'tap' }
  if (target === 'double_tap') return { event: 'double_tap' }
  if (target === 'pinch_hold') return { event: 'pinch_hold' }
  return { event: 'recognized', name: target }
}

// Guided, real measurements only. Every proposal must be accepted by the user;
// nothing here writes thresholds automatically.
export function AdaptiveGesturePanel() {
  const { enabled, settings, updateSettings, subscribeFeatures, subscribePreview, getVideoElement, metrics, showNotice } = useHgi()
  const [adaptive, setAdaptive] = useState(() => loadAdaptiveSettings())
  const [wizard, setWizard] = useState<{ phase: WizardPhase; remainingMs: number } | null>(null)
  const [proposal, setProposal] = useState<TuningProposal | null>(null)
  const [lighting, setLighting] = useState<LightingVerdict>(() => classifyLighting(null))
  const [suite, setSuite] = useState<{ target: GestureSuiteTarget; trial: number; phase: 'prompt' | 'rest' } | null>(null)
  const [suiteResult, setSuiteResult] = useState<GestureSuiteResult | null>(() => latestGestureSuite())
  const [suiteMessage, setSuiteMessage] = useState<string | null>(null)
  const lightsRef = useRef<HandLandmarks[]>([])
  const cancelSuiteRef = useRef(false)

  useEffect(() => {
    const onAdaptive = () => setAdaptive(loadAdaptiveSettings())
    window.addEventListener('bozz:adaptive-settings', onAdaptive)
    return () => window.removeEventListener('bozz:adaptive-settings', onAdaptive)
  }, [])

  useEffect(() => {
    return subscribePreview((hands) => {
      lightsRef.current = hands
    })
  }, [subscribePreview])

  useEffect(() => {
    if (!enabled) return
    const measure = () => {
      const frame = measureFrameLighting(getVideoElement())
      const coverage = landmarkCoverage(lightsRef.current[0]?.landmarks ?? [])
      setLighting(
        classifyLighting({
          brightness: frame?.brightness ?? Number.NaN,
          contrast: frame?.contrast ?? 0,
          coverage,
          score: metrics.hands > 0 ? metrics.trackingConfidence : null,
        }),
      )
    }
    const timer = window.setInterval(measure, 3000)
    return () => window.clearInterval(timer)
  }, [enabled, getVideoElement, metrics.hands, metrics.trackingConfidence])

  const startWizard = useCallback(() => {
    if (!enabled) {
      showNotice('Start gestures before tuning — the wizard needs live landmark frames.')
      return
    }
    const samples: TuningSamples = { pinched: [], open: [], tapDurationsMs: [], holdDurationsMs: [] }
    let pressed = false
    const startedAt = performance.now()
    const offFeatures = subscribeFeatures((frame) => {
      const hand = frame.hands.find((item) => item.score >= 0.5)
      if (!hand) return
      if (pressed) samples.pinched.push(hand.pinchRatio)
      else samples.open.push(hand.pinchRatio)
    })
    const offStart = gestureBus.on('gesture.pinch_start', () => {
      pressed = true
    })
    const offEnd = gestureBus.on('gesture.pinch_end', (payload) => {
      pressed = false
      if (payload.heldMs > 0 && payload.heldMs <= 500) samples.tapDurationsMs.push(payload.heldMs)
      if (payload.heldMs >= 300) samples.holdDurationsMs.push(payload.heldMs)
    })
    setProposal(null)
    setWizard({ phase: 'pinches', remainingMs: WIZARD_MS })
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt
      if (elapsed >= WIZARD_MS) {
        window.clearInterval(timer)
        offFeatures()
        offStart()
        offEnd()
        setWizard(null)
        const current = loadAdaptiveSettings()
        setProposal(
          proposeTuning(
            samples,
            {
              pinchOn: settings.pinchOn,
              pinchOff: settings.pinchOff,
              tapMaxMs: current.gestures.tapMaxMs,
              holdMs: current.gestures.holdMs,
            },
          ),
        )
        return
      }
      setWizard({ phase: wizardPhase(elapsed), remainingMs: WIZARD_MS - elapsed })
    }, 250)
  }, [enabled, settings.pinchOff, settings.pinchOn, showNotice, subscribeFeatures])

  const applyProposal = useCallback(() => {
    if (!proposal?.usable) return
    const current = loadAdaptiveSettings()
    const next = updateAdaptiveSettings({
      gestures: {
        ...current.gestures,
        tapMaxMs: proposal.tapMaxMs,
        holdMs: proposal.holdMs,
        tunedFrom: { ...current.gestures.tunedFrom, proposalAcceptedAt: Date.now() },
      },
    })
    setAdaptive(next)
    updateSettings({ pinchOn: proposal.pinchOn, pinchOff: proposal.pinchOff })
    showNotice(`Tuning applied: pinch on ${proposal.pinchOn}, off ${proposal.pinchOff}, tap ≤ ${proposal.tapMaxMs} ms, hold ≥ ${proposal.holdMs} ms.`)
    setProposal(null)
  }, [proposal, showNotice, updateSettings])

  const waitForTarget = useCallback((target: GestureSuiteTarget): Promise<{ hit: boolean; latencyMs: number | null }> => {
    const spec = suiteEvent(target)
    return new Promise((resolve) => {
      const startedAt = performance.now()
      let latency: number | null = null
      const unsubscribes: Array<() => void> = []
      const hit = () => {
        if (latency === null) latency = performance.now() - startedAt
      }
      if (spec.event === 'pinch_start') unsubscribes.push(gestureBus.on('gesture.pinch_start', hit))
      else if (spec.event === 'tap') unsubscribes.push(gestureBus.on('gesture.tap', hit))
      else if (spec.event === 'double_tap') unsubscribes.push(gestureBus.on('gesture.double_tap', hit))
      else if (spec.event === 'pinch_hold') unsubscribes.push(gestureBus.on('gesture.pinch_hold', hit))
      else {
        unsubscribes.push(
          gestureBus.on('gesture.recognized', (payload) => {
            if (payload.name === spec.name) hit()
          }),
        )
      }
      window.setTimeout(() => {
        for (const off of unsubscribes) off()
        resolve({ hit: latency !== null, latencyMs: latency === null ? null : Math.round(latency) })
      }, PROMPT_MS)
    })
  }, [])

  const waitRest = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      let triggered = false
      const mark = () => {
        triggered = true
      }
      const unsubscribes = [
        gestureBus.on('gesture.pinch_start', mark),
        gestureBus.on('gesture.tap', mark),
        gestureBus.on('gesture.double_tap', mark),
        gestureBus.on('gesture.pinch_hold', mark),
        gestureBus.on('gesture.recognized', (payload) => {
          if (payload.name === 'point' || payload.name === 'flick' || payload.name === 'open_palm') triggered = true
        }),
      ]
      window.setTimeout(() => {
        for (const off of unsubscribes) off()
        resolve(triggered)
      }, REST_MS)
    })
  }, [])

  const runSuite = useCallback(async () => {
    if (!enabled) {
      setSuiteMessage('Start gestures first — the suite needs live recognition events.')
      return
    }
    cancelSuiteRef.current = false
    setSuiteMessage(null)
    setSuiteResult(null)
    const trials: GestureSuiteTrial[] = []
    let falseTriggers = 0
    let idleMs = 0
    try {
      for (const target of GESTURE_SUITE_TARGETS) {
        for (let trial = 1; trial <= TRIALS_PER_GESTURE; trial += 1) {
          if (cancelSuiteRef.current) break
          setSuite({ target, trial, phase: 'prompt' })
          const prompt = await waitForTarget(target)
          if (cancelSuiteRef.current) break
          setSuite({ target, trial, phase: 'rest' })
          const falseTrigger = await waitRest()
          idleMs += REST_MS
          if (falseTrigger) falseTriggers += 1
          trials.push({ target, hit: prompt.hit, latencyMs: prompt.latencyMs })
        }
        if (cancelSuiteRef.current) break
      }
      if (cancelSuiteRef.current) {
        setSuiteMessage('Suite cancelled. Nothing was saved.')
        return
      }
      const result = summarizeGestureSuite({
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        createdAt: Date.now(),
        quality: settings.quality,
        trials,
        idleSeconds: idleMs / 1000,
        falseTriggers,
      })
      saveGestureSuite(result)
      setSuiteResult(result)
      setSuiteMessage(`Saved ${trials.length} real trials for ${GESTURE_SUITE_TARGETS.length} gestures.`)
    } finally {
      setSuite(null)
    }
  }, [enabled, settings.quality, waitForTarget, waitRest])

  const evaluation = evaluateGestureSuite(suiteResult, adaptive.gestures.suite)
  const suiteRunning = suite !== null

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><Gauge /> Adaptive gestures</h3>
        <span className="hgi-chip">MEASURED ONLY</span>
      </div>
      <p>
        Transitions instead of single frames: pinch-on waits {adaptive.gestures.enterMs} ms below the threshold,
        pinch-hold needs {adaptive.gestures.holdMs} ms, release uses hysteresis, and a tap is a pinch shorter than{' '}
        {adaptive.gestures.tapMaxMs} ms. Left and right hands have separate thresholds.
      </p>

      <div className="hgi-card__head hgi-card__head--sub">
        <h4><Timer /> Tune gestures (60 s)</h4>
      </div>
      {wizard ? (
        <div className="hgi-test" aria-live="polite">
          <p className="hgi-test__trial">Tuning · {Math.ceil(wizard.remainingMs / 1000)} s left</p>
          <strong>{wizard.phase === 'review' ? 'Finishing…' : PHASE_COPY[wizard.phase]}</strong>
          <div className="hgi-test__bar" style={{ animationDuration: `${WIZARD_MS}ms` }} />
        </div>
      ) : (
        <p className="hgi-card__note">
          The wizard records real pinch ratios and hold durations. It only proposes new thresholds; you decide whether to apply them.
        </p>
      )}
      <div className="hgi-field-row">
        <button type="button" className="hgi-btn hgi-btn--accent" onClick={startWizard} disabled={wizard !== null || !enabled}>
          <Timer /> {wizard ? 'Recording…' : 'Start 60 s tune'}
        </button>
      </div>

      {proposal && (
        <div className="hgi-proposal" role="status">
          {proposal.usable ? (
            <>
              <strong>Proposed thresholds (not applied)</strong>
              <dl className="hgi-mini-stats hgi-mini-stats--wide">
                <div><dt>Pinch on</dt><dd>{proposal.pinchOn}</dd></div>
                <div><dt>Pinch off</dt><dd>{proposal.pinchOff}</dd></div>
                <div><dt>Tap max</dt><dd>{proposal.tapMaxMs} ms</dd></div>
                <div><dt>Hold min</dt><dd>{proposal.holdMs} ms</dd></div>
                <div><dt>Pinched frames</dt><dd>{proposal.samples.pinched}</dd></div>
                <div><dt>Open frames</dt><dd>{proposal.samples.open}</dd></div>
              </dl>
              <ul className="hgi-reasons">
                {proposal.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <div className="hgi-field-row">
                <button type="button" className="hgi-btn hgi-btn--accent" onClick={applyProposal}>
                  <CheckCircle2 /> Apply proposal
                </button>
                <button type="button" className="hgi-btn" onClick={() => setProposal(null)}>Dismiss</button>
              </div>
            </>
          ) : (
            <>
              <strong>Not enough data to propose thresholds</strong>
              <p>{proposal.reasons[0]}</p>
              <button type="button" className="hgi-btn" onClick={() => setProposal(null)}>Dismiss</button>
            </>
          )}
        </div>
      )}

      <div className="hgi-card__head hgi-card__head--sub">
        <h4><Sun /> Lighting and camera check</h4>
        <span className={`hgi-chip ${lighting.level === 'ok' ? 'is-good' : ''}`}>
          {lighting.measured ? lighting.level.toUpperCase() : 'NOT MEASURED YET'}
        </span>
      </div>
      <p className={`hgi-lighting hgi-lighting--${lighting.level}`}>{lighting.advice}</p>
      <p className="hgi-card__note">{lighting.detail}</p>

      <div className="hgi-card__head hgi-card__head--sub">
        <h4><Activity /> Gesture suite</h4>
        <span className={`hgi-chip ${evaluation.status === 'pass' ? 'is-good' : ''}`}>
          {evaluation.status === 'pass' ? 'PASS' : evaluation.status === 'needs-tuning' ? 'NEEDS TUNING' : 'NOT MEASURED YET'}
        </span>
      </div>
      <p>
        {GESTURE_SUITE_TARGETS.length} gestures × {TRIALS_PER_GESTURE} trials. Each prompt is {PROMPT_MS / 1000} s with a{' '}
        {REST_MS / 1000} s rest window that counts false triggers while idle.
      </p>
      {suiteRunning && suite ? (
        <div className={`hgi-test ${suite.phase === 'rest' ? 'is-rest' : ''}`} aria-live="polite">
          <p className="hgi-test__trial">Trial {suite.trial} of {TRIALS_PER_GESTURE} · {GESTURE_TARGET_COPY[suite.target]}</p>
          <strong>{suite.phase === 'prompt' ? `Show: ${GESTURE_TARGET_COPY[suite.target]}` : 'Relax your hand'}</strong>
          <div
            className="hgi-test__bar"
            key={`${suite.target}-${suite.trial}-${suite.phase}`}
            style={{ animationDuration: `${suite.phase === 'prompt' ? PROMPT_MS : REST_MS}ms` }}
          />
        </div>
      ) : (
        <div className="hgi-field-row">
          <button type="button" className="hgi-btn hgi-btn--accent" onClick={() => void runSuite()} disabled={!enabled}>
            <Play /> Run suite
          </button>
          {suiteRunning && (
            <button
              type="button"
              className="hgi-btn hgi-btn--danger"
              onClick={() => {
                cancelSuiteRef.current = true
              }}
            >
              <Square /> Cancel
            </button>
          )}
        </div>
      )}
      {suiteMessage && <p className="hgi-message" role="status">{suiteMessage}</p>}
      <dl className="hgi-mini-stats hgi-mini-stats--wide">
        {evaluation.metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>
              {metric.value}
              {metric.measured && metric.pass !== null && <small>{metric.pass ? ' · pass' : ' · below target'}</small>}
            </dd>
          </div>
        ))}
      </dl>
      {suiteResult && (
        <p className="hgi-card__note">
          {Object.entries(suiteResult.perGesture)
            .map(([name, entry]) => `${GESTURE_TARGET_COPY[name as GestureSuiteTarget] ?? name}: ${entry.hits}/${entry.trials}`)
            .join(' · ')}
        </p>
      )}
      <p className="hgi-card__note">{evaluation.detail}</p>
    </div>
  )
}
