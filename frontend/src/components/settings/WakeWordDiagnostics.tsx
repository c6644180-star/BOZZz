import { useCallback, useEffect, useState } from 'react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { fetchWakeWordStatus, validateWakeWordAssets } from '../../services/wakeWord'
import type { WakeWordAssetStatus } from '../../services/wakeWord'
import {
  getWakeWordRuntimeState,
  startWakeWordListening,
  stopWakeWordListening,
  dismissWakeWordRuntimeStatus,
  type WakeWordRuntimeState,
} from '../../services/wakeWordRuntime'

const ASSETS = [
  ['wake_word', 'BOZZ phrase classifier'],
  ['melspectrogram', 'Audio feature model'],
  ['embedding', 'Embedding model'],
] as const

function statusLabel(status: string): string {
  return ({
    assets_missing: 'Model files missing',
    assets_configured: 'Files configured · not loaded',
    engine_dependencies_missing: 'Optional runtime missing',
    engine_invalid: 'Model could not load',
    unsupported_format: 'Unsupported model format',
    engine_loadable_not_accuracy_verified: 'Loaded · accuracy not verified',
  } as Record<string, string>)[status] ?? status.replace(/_/g, ' ')
}

export function WakeWordDiagnostics() {
  const { settings } = useBozzVoice()
  const [report, setReport] = useState<WakeWordAssetStatus | null>(null)
  const [busy, setBusy] = useState<'checking' | 'validating' | null>('checking')
  const [error, setError] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<WakeWordRuntimeState>(() => getWakeWordRuntimeState())

  const refresh = useCallback(async () => {
    setBusy('checking')
    setError(null)
    try {
      setReport(await fetchWakeWordStatus())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not check local wake-word assets.')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<WakeWordRuntimeState>).detail
      if (detail) setRuntime(detail)
    }
    window.addEventListener('bozz:wake-word-state', onState)
    return () => window.removeEventListener('bozz:wake-word-state', onState)
  }, [])

  useEffect(() => {
    if (!settings.backgroundListeningConsent && (runtime.phase === 'starting' || runtime.phase === 'listening')) {
      stopWakeWordListening()
    }
  }, [runtime.phase, settings.backgroundListeningConsent])

  async function validate() {
    if (busy) return
    if (!window.confirm('Load the configured wake-word model on the CPU for a one-time check? This can use extra RAM. No microphone will be opened.')) return
    setBusy('validating')
    setError(null)
    try {
      setReport(await validateWakeWordAssets())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Wake-word model validation failed.')
    } finally {
      setBusy(null)
    }
  }

  async function start() {
    if (!report?.engine_loadable || !settings.backgroundListeningConsent || runtime.phase === 'starting' || runtime.phase === 'listening') return
    if (!window.confirm(
      'Start local wake-word listening now? BOZZ will request microphone permission. The mic stays active while BOZZ is hidden until you stop it or the wake phrase is detected. Audio is sent only to the local BOZZ backend, is not saved, and is not uploaded. Detection restores BOZZ but does not start command recording.',
    )) return
    setError(null)
    try {
      await startWakeWordListening()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Wake-word listening could not start.')
    }
  }

  const active = runtime.phase === 'starting' || runtime.phase === 'listening'
  return (
    <section className="settings-module-permissions" aria-labelledby="wake-word-diagnostics-title">
      <h3 id="wake-word-diagnostics-title">Local “BOZZ” wake-word setup</h3>
      <p>
        Check the three local ONNX assets and optional CPU runtime. Validation loads the model once, but does not
        activate the microphone, record audio, or start background listening.
      </p>
      {report ? (
        <>
          <p><strong>Model status:</strong> {statusLabel(report.status)}</p>
          <ul>
            {ASSETS.map(([key, label]) => {
              const file = report.files[key]
              return (
                <li key={key}>
                  <strong>{label}:</strong>{' '}
                  {file?.exists && file.supported_format
                    ? `ready · ${file.file_name ?? 'ONNX file'}`
                    : file?.configured
                      ? 'configured but missing or unsupported'
                      : 'not configured'}
                </li>
              )
            })}
          </ul>
          <p role="status">{report.detail}</p>
          <p>
            <strong>Runtime:</strong> {report.runtime_available ? 'available' : 'not available'} ·{' '}
            <strong>Model loaded:</strong> {report.engine_loadable ? 'yes' : 'no'} ·{' '}
            <strong>Backend microphone capture:</strong> no (capture is in the desktop renderer)
          </p>
        </>
      ) : (
        <p role="status">{busy === 'checking' ? 'Checking local model configuration…' : 'No diagnostic report yet.'}</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <div className="desktop-app-launcher__actions">
        <button type="button" className="secondary-action" disabled={busy !== null || active} onClick={() => void refresh()}>
          {busy === 'checking' ? 'Checking…' : 'Refresh status'}
        </button>
        <button type="button" className="secondary-action" disabled={busy !== null || active || !report?.configured} onClick={() => void validate()}>
          {busy === 'validating' ? 'Loading model…' : 'Validate local model'}
        </button>
      </div>

      <div className="wake-word-runtime" aria-live="polite">
        <p><strong>Listener:</strong> {runtime.phase === 'off' ? 'OFF' : runtime.phase.toUpperCase()}</p>
        <p>{runtime.detail}</p>
        {runtime.phase === 'listening' ? (
          <button type="button" className="secondary-action" onClick={stopWakeWordListening}>
            Stop wake-word listener
          </button>
        ) : runtime.phase === 'detected' || runtime.phase === 'error' ? (
          <button type="button" className="secondary-action" onClick={dismissWakeWordRuntimeStatus}>
            Acknowledge status
          </button>
        ) : (
          <button
            type="button"
            className="secondary-action"
            disabled={!report?.engine_loadable || !settings.backgroundListeningConsent || busy !== null || runtime.phase === 'starting'}
            onClick={() => void start()}
          >
            {runtime.phase === 'starting' ? 'Starting…' : 'Start local wake-word listener'}
          </button>
        )}
        {!settings.backgroundListeningConsent && (
          <small>First enable “Allow future background listening” above. The separate Start button is still required.</small>
        )}
      </div>

      <small>
        Listening uses the validated model at a 0.5 score threshold with two consecutive frames. This is experimental:
        it may miss the phrase or trigger incorrectly. On detection, BOZZ restores its window and turns the microphone off;
        you must press the mic button to speak. The tray also provides a stop control.
      </small>
    </section>
  )
}
