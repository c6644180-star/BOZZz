import { useCallback, useEffect, useRef, useState } from 'react'
import { asrAvailable, startListening } from '../../services/speech'
import { CpuMonitor } from '../../adaptive/cpu'
import { loadAdaptiveSettings } from '../../adaptive/settings'
import {
  evaluateVoiceBenchmark,
  latestVoiceBenchmark,
  saveVoiceBenchmark,
  type VoiceBenchmarkResult,
} from '../../adaptive/benchmarks'
import { getWakeWordEngine, wakeWordStatus } from '../../adaptive/wakeWord'

const ENGLISH_PROMPTS = [
  'open settings',
  'show my projects',
  'open the intent map',
  'start the camera',
  'stop everything',
  'what time is it',
  'open the chat',
  'show my history',
  'turn on captions',
  'switch to manual mode',
  'read the last message',
  'open desktop control',
  'zoom the model in',
  'reset the orb',
  'open the reliability report',
  'turn off the microphone',
  'show system status',
  'open the holographic workspace',
  'confirm the action',
  'take a screenshot',
]

const TANGLISH_PROMPTS = [
  'settings open pannu',
  'projects kaattu',
  'chat open pannu',
  'camera start pannu',
  'ellathayum niruthu',
  'history kaattu',
  'captions on pannu',
  'manual mode ku maathu',
  'kadaisi message padichu sollu',
  'desktop control open pannu',
  'model ah zoom pannu',
  'orb ah reset pannu',
  'system status kaattu',
  'microphone off pannu',
  'intent map open pannu',
  'hologram workspace open pannu',
  'reliability report open pannu',
  'action ah confirm pannu',
  'enna nadakkuthu',
  'time enna',
]

const PTT_TARGET = 3
const SILENCE_SECONDS = 30
const WAKE_SECONDS = 60

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = Array.from({ length: cols }, (_, index) => index)
  for (let row = 1; row < rows; row += 1) {
    const current = [row]
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      current[col] = Math.min(previous[col] + 1, current[col - 1] + 1, previous[col - 1] + cost)
    }
    previous = current
  }
  return previous[b.length]
}

function transcriptMatches(expected: string, heard: string): boolean {
  const a = normalize(expected)
  const b = normalize(heard)
  if (!b) return false
  if (a === b) return true
  const tolerance = Math.max(2, Math.floor(a.length * 0.15))
  return editDistance(a, b) <= tolerance
}

interface AccuracyEntry {
  heard: string
  correct: boolean
}

interface Listening {
  kind: 'ptt' | 'english' | 'tanglish' | 'silence'
  active: true
}

export function VoiceBenchmarkPanel() {
  const [pttLatencies, setPttLatencies] = useState<number[]>([])
  const [english, setEnglish] = useState<Record<number, AccuracyEntry>>({})
  const [tanglish, setTanglish] = useState<Record<number, AccuracyEntry>>({})
  const [englishIndex, setEnglishIndex] = useState(0)
  const [tanglishIndex, setTanglishIndex] = useState(0)
  const [listening, setListening] = useState<Listening | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [silenceLeft, setSilenceLeft] = useState<number | null>(null)
  const [silenceCount, setSilenceCount] = useState(0)
  const [wakeCpu, setWakeCpu] = useState<{ cpu: number | null; ram: number | null } | null>(null)
  const [wakeRunning, setWakeRunning] = useState(false)
  const [saved, setSaved] = useState<VoiceBenchmarkResult | null>(() => latestVoiceBenchmark())
  const [error, setError] = useState<string | null>(null)

  const listenerRef = useRef<{ stop: () => void } | null>(null)
  const releaseRef = useRef<number | null>(null)
  const silenceActiveRef = useRef(false)
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceCountRef = useRef(0)
  const silenceStartedRef = useRef(0)
  const silenceSecondsRef = useRef(0)
  const wakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopListener = useCallback(() => {
    listenerRef.current?.stop()
    listenerRef.current = null
  }, [])

  useEffect(() => () => {
    stopListener()
    silenceActiveRef.current = false
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
    if (wakeTimerRef.current) clearInterval(wakeTimerRef.current)
  }, [stopListener])

  const recordPtt = useCallback((heard: string) => {
    const releasedAt = releaseRef.current
    releaseRef.current = null
    if (releasedAt === null) {
      setStatusText(`Heard “${heard}” but the key-release timestamp was missing, so no latency was recorded.`)
      return
    }
    const latency = Math.max(0, Math.round(performance.now() - releasedAt))
    setPttLatencies((values) => [...values, latency].slice(0, 10))
    setStatusText(`Heard “${heard}” · ${latency} ms from key release to final text.`)
  }, [])

  const startPttHold = useCallback(() => {
    if (!asrAvailable()) {
      setError('This browser has no speech recognition, so push-to-talk latency cannot be measured.')
      return
    }
    if (listening) return
    setError(null)
    releaseRef.current = null
    listenerRef.current = startListening(
      {
        onPartial: () => {},
        onFinal: (text) => {
          stopListener()
          setListening(null)
          recordPtt(text)
        },
        onError: (reason) => {
          stopListener()
          setListening(null)
          setError(`Speech recognition error: ${reason}`)
        },
        onEnd: () => {},
      },
      { continuous: false },
    )
    setListening({ kind: 'ptt', active: true })
    setStatusText('Listening. Say a short command, then release the button.')
  }, [listening, recordPtt, stopListener])

  const endPttHold = useCallback(() => {
    if (!listenerRef.current) return
    releaseRef.current = performance.now()
    listenerRef.current.stop()
    listenerRef.current = null
    setListening(null)
    setStatusText('Key released. Waiting for the recogniser to finalise the text…')
  }, [])

  const runPrompt = useCallback((kind: 'english' | 'tanglish', prompt: string, index: number) => {
    if (!asrAvailable()) {
      setError('This browser has no speech recognition, so accuracy cannot be measured.')
      return
    }
    if (listening) return
    setError(null)
    stopListener()
    listenerRef.current = startListening(
      {
        onPartial: () => {},
        onFinal: (text) => {
          stopListener()
          setListening(null)
          const entry = { heard: text, correct: transcriptMatches(prompt, text) }
          if (kind === 'english') {
            setEnglish((current) => ({ ...current, [index]: entry }))
            setEnglishIndex((current) => Math.min(ENGLISH_PROMPTS.length, Math.max(current, index + 1)))
          } else {
            setTanglish((current) => ({ ...current, [index]: entry }))
            setTanglishIndex((current) => Math.min(TANGLISH_PROMPTS.length, Math.max(current, index + 1)))
          }
          setStatusText(`Prompt “${prompt}” → heard “${text || '(nothing)'}” · ${entry.correct ? 'match' : 'no match'}.`)
        },
        onError: (reason) => {
          stopListener()
          setListening(null)
          setError(`Speech recognition error: ${reason}`)
        },
        onEnd: () => {},
      },
      { continuous: false },
    )
    setListening({ kind, active: true })
  }, [listening, stopListener])

  const startSilenceTest = useCallback(() => {
    if (!asrAvailable()) {
      setError('This browser has no speech recognition, so a silence test cannot run.')
      return
    }
    if (listening || silenceActiveRef.current) return
    setError(null)
    stopListener()
    silenceCountRef.current = 0
    silenceStartedRef.current = performance.now()
    silenceSecondsRef.current = 0
    silenceActiveRef.current = true
    setSilenceCount(0)
    setSilenceLeft(SILENCE_SECONDS)
    setStatusText(`Stay quiet for ${SILENCE_SECONDS} seconds. Any final transcript counts as a false activation.`)

    const begin = () => {
      listenerRef.current = startListening(
        {
          onPartial: () => {},
          onFinal: (text) => {
            if (!text) return
            silenceCountRef.current += 1
            setSilenceCount(silenceCountRef.current)
          },
          onError: () => {},
          onEnd: () => {
            if (silenceActiveRef.current) begin()
          },
        },
        { continuous: true },
      )
    }
    begin()

    silenceTimerRef.current = setInterval(() => {
      const elapsed = (performance.now() - silenceStartedRef.current) / 1000
      silenceSecondsRef.current = elapsed
      const remaining = Math.max(0, Math.ceil(SILENCE_SECONDS - elapsed))
      setSilenceLeft(remaining)
      if (elapsed >= SILENCE_SECONDS) {
        silenceActiveRef.current = false
        stopListener()
        if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
        silenceTimerRef.current = null
        setSilenceLeft(null)
        setStatusText(
          `Silence test finished: ${silenceCountRef.current} final transcript${silenceCountRef.current === 1 ? '' : 's'} in ${Math.round(elapsed)} s.`,
        )
      }
    }, 250)
  }, [listening, stopListener])

  const startWakeMeasurement = useCallback(async () => {
    const engine = getWakeWordEngine()
    if (!engine.available) {
      setError(wakeWordStatus().detail)
      return
    }
    setError(null)
    setWakeRunning(true)
    setWakeCpu(null)
    const monitor = new CpuMonitor({ intervalMs: 1000 })
    monitor.start()
    const startedAt = performance.now()
    await engine.start(() => {})
    wakeTimerRef.current = setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000
      setStatusText(`Measuring wake-word cost: ${Math.round(elapsed)} of ${WAKE_SECONDS} s.`)
      if (elapsed >= WAKE_SECONDS) {
        if (wakeTimerRef.current) clearInterval(wakeTimerRef.current)
        wakeTimerRef.current = null
        monitor.stop()
        engine.stop()
        setWakeRunning(false)
        setWakeCpu({ cpu: monitor.averagePercent(), ram: monitor.ramAverageMb() })
        setStatusText(`Wake-word measurement finished after ${WAKE_SECONDS} s.`)
      }
    }, 500)
  }, [])

  const buildResult = useCallback((): VoiceBenchmarkResult => {
    const englishAttempts = Object.keys(english).length
    const englishCorrect = Object.values(english).filter((entry) => entry.correct).length
    const tanglishAttempts = Object.keys(tanglish).length
    const tanglishCorrect = Object.values(tanglish).filter((entry) => entry.correct).length
    const pttAverage = pttLatencies.length > 0
      ? Math.round(pttLatencies.reduce((sum, value) => sum + value, 0) / pttLatencies.length)
      : null
    const measuredSilenceSeconds = silenceSecondsRef.current
    const perHour = measuredSilenceSeconds > 0
      ? (silenceCountRef.current / measuredSilenceSeconds) * 3600
      : null
    const engineInstalled = getWakeWordEngine().available
    return {
      version: 1,
      id: `voice-${Date.now()}`,
      createdAt: Date.now(),
      wake: {
        engineInstalled,
        seconds: wakeCpu ? WAKE_SECONDS : 0,
        cpuPercent: wakeCpu?.cpu ?? null,
        ramMb: wakeCpu?.ram ?? null,
        detail: engineInstalled
          ? 'Measured through the installed wake-word engine.'
          : 'No offline wake-word engine is installed, so nothing could be measured.',
      },
      ptt: { samples: pttLatencies.length, avgLatencyMs: pttAverage },
      falseActivations: {
        seconds: measuredSilenceSeconds,
        count: silenceCountRef.current,
        perHour: perHour === null ? null : Math.round(perHour * 100) / 100,
      },
      accuracy: {
        english: {
          prompted: englishAttempts,
          correct: englishCorrect,
          accuracy: englishAttempts >= ENGLISH_PROMPTS.length ? englishCorrect / ENGLISH_PROMPTS.length : null,
        },
        tanglish: {
          prompted: tanglishAttempts,
          correct: tanglishCorrect,
          accuracy: tanglishAttempts >= TANGLISH_PROMPTS.length ? tanglishCorrect / TANGLISH_PROMPTS.length : null,
        },
      },
    }
  }, [english, pttLatencies, tanglish, wakeCpu])

  const save = useCallback(() => {
    const result = buildResult()
    saveVoiceBenchmark(result)
    setSaved(result)
    setStatusText('Benchmark saved on this device. Unmeasured parts stay marked “Not measured yet”.')
  }, [buildResult])

  const thresholds = loadAdaptiveSettings().voice
  const evaluation = evaluateVoiceBenchmark(saved, thresholds, wakeWordStatus().installed)
  const englishDone = englishIndex >= ENGLISH_PROMPTS.length
  const tanglishDone = tanglishIndex >= TANGLISH_PROMPTS.length
  const canSave = pttLatencies.length > 0 || Object.keys(english).length > 0 || Object.keys(tanglish).length > 0 || silenceSecondsRef.current > 0 || wakeCpu !== null

  return (
    <section className="settings-group voice-bench" aria-label="Voice benchmark">
      <h3>Voice benchmark</h3>
      <p className="settings-note">
        Every number here is measured on this device with the browser’s real recogniser. Nothing is simulated.
        Phrases are compared with a small edit-distance tolerance, so near-misses count as matches.
      </p>

      <div className={`hgi-chip ${evaluation.status === 'pass' ? 'is-good' : ''}`}>
        {evaluation.status === 'pass' ? 'Pass' : evaluation.status === 'needs-tuning' ? 'Needs tuning' : 'Not measured yet'}
        <small>{evaluation.detail}</small>
      </div>

      {!asrAvailable() && (
        <p className="settings-note">This browser has no speech recognition, so none of the voice checks can run here.</p>
      )}
      {error && <p className="settings-note">{error}</p>}

      <div className="voice-bench__block">
        <h4>1. Push-to-talk latency</h4>
        <p>Hold the button, say “open settings”, then release. Repeat three times.</p>
        <button
          type="button"
          className="secondary-action"
          onPointerDown={startPttHold}
          onPointerUp={endPttHold}
          onPointerLeave={endPttHold}
          onPointerCancel={endPttHold}
          disabled={!!listening || !asrAvailable()}
        >
          {listening?.kind === 'ptt' ? 'Listening — release to send' : 'Hold to talk'}
        </button>
        <p className="settings-note">
          {pttLatencies.length === 0
            ? 'Not measured yet'
            : `${pttLatencies.length}/${PTT_TARGET} samples · ${Math.round(pttLatencies.reduce((sum, value) => sum + value, 0) / pttLatencies.length)} ms average`}
        </p>
      </div>

      <div className="voice-bench__block">
        <h4>2. English accuracy</h4>
        <p>
          Prompt {Math.min(englishIndex + 1, ENGLISH_PROMPTS.length)} of {ENGLISH_PROMPTS.length}:{' '}
          <strong>“{ENGLISH_PROMPTS[Math.min(englishIndex, ENGLISH_PROMPTS.length - 1)]}”</strong>
        </p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => runPrompt('english', ENGLISH_PROMPTS[englishIndex], englishIndex)}
          disabled={englishDone || !!listening || !asrAvailable()}
        >
          {englishDone ? 'English prompts complete' : listening?.kind === 'english' ? 'Listening…' : 'Record this prompt'}
        </button>
        <p className="settings-note">
          {Object.keys(english).length === 0
            ? 'Not measured yet'
            : `${Object.values(english).filter((entry) => entry.correct).length} matched of ${Object.keys(english).length} attempted${englishDone ? '' : ' — run all 20 to get a rate'}`}
        </p>
      </div>

      <div className="voice-bench__block">
        <h4>3. Tanglish accuracy</h4>
        <p>
          Prompt {Math.min(tanglishIndex + 1, TANGLISH_PROMPTS.length)} of {TANGLISH_PROMPTS.length}:{' '}
          <strong>“{TANGLISH_PROMPTS[Math.min(tanglishIndex, TANGLISH_PROMPTS.length - 1)]}”</strong>
        </p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => runPrompt('tanglish', TANGLISH_PROMPTS[tanglishIndex], tanglishIndex)}
          disabled={tanglishDone || !!listening || !asrAvailable()}
        >
          {tanglishDone ? 'Tanglish prompts complete' : listening?.kind === 'tanglish' ? 'Listening…' : 'Record this prompt'}
        </button>
        <p className="settings-note">
          {Object.keys(tanglish).length === 0
            ? 'Not measured yet'
            : `${Object.values(tanglish).filter((entry) => entry.correct).length} matched of ${Object.keys(tanglish).length} attempted${tanglishDone ? '' : ' — run all 20 to get a rate'}`}
        </p>
      </div>

      <div className="voice-bench__block">
        <h4>4. False activations in silence</h4>
        <p>Stay quiet for {SILENCE_SECONDS} seconds with the microphone open. Any final transcript is counted.</p>
        <button
          type="button"
          className="secondary-action"
          onClick={startSilenceTest}
          disabled={!!listening || silenceLeft !== null || !asrAvailable()}
        >
          {silenceLeft !== null ? `Listening — ${silenceLeft} s left` : 'Run silence test'}
        </button>
        <p className="settings-note">
          {silenceLeft === null && silenceSecondsRef.current === 0
            ? 'Not measured yet'
            : `${silenceCount} transcript${silenceCount === 1 ? '' : 's'} in ${Math.round(silenceSecondsRef.current)} s`}
        </p>
      </div>

      <div className="voice-bench__block">
        <h4>5. Wake-word CPU and RAM</h4>
        <p>Runs for {WAKE_SECONDS} seconds through the installed wake-word engine.</p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => void startWakeMeasurement()}
          disabled={wakeRunning || getWakeWordEngine().available === false}
        >
          {wakeRunning ? 'Measuring…' : 'Measure wake-word cost'}
        </button>
        <p className="settings-note">
          {wakeWordStatus().detail}{' '}
          {wakeCpu
            ? `Measured: ${wakeCpu.cpu ?? '—'}% main-thread load, ${wakeCpu.ram === null ? 'RAM not available' : `${wakeCpu.ram} MB heap`}.`
            : 'Not measured yet'}
        </p>
      </div>

      {statusText && <p className="settings-note">{statusText}</p>}

      <p>
        <button type="button" className="secondary-action" onClick={save} disabled={!canSave}>
          Save benchmark
        </button>
      </p>

      {saved && (
        <div className="voice-bench__result">
          {evaluation.metrics.map((metric) => (
            <p key={metric.label} className="settings-note">
              <strong>{metric.label}:</strong> {metric.value}
              {metric.measured && metric.pass !== null ? (metric.pass ? ' · pass' : ' · below target') : ''}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
