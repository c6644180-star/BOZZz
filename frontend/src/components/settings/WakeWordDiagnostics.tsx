import { useCallback, useEffect, useState } from 'react'
import { fetchWakeWordStatus, validateWakeWordAssets } from '../../services/wakeWord'
import type { WakeWordAssetStatus } from '../../services/wakeWord'

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
  const [report, setReport] = useState<WakeWordAssetStatus | null>(null)
  const [busy, setBusy] = useState<'checking' | 'validating' | null>('checking')
  const [error, setError] = useState<string | null>(null)

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

  return (
    <section className="settings-module-permissions" aria-labelledby="wake-word-diagnostics-title">
      <h3 id="wake-word-diagnostics-title">Local “BOZZ” wake-word setup</h3>
      <p>
        Check the three local ONNX assets and optional CPU runtime. Validation loads the model once, but does not
        activate the microphone, record audio, or start background listening.
      </p>
      {report ? (
        <>
          <p><strong>Status:</strong> {statusLabel(report.status)}</p>
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
            <strong>Microphone opened:</strong> {report.microphone_opened ? 'yes' : 'no'}
          </p>
        </>
      ) : (
        <p role="status">{busy === 'checking' ? 'Checking local model configuration…' : 'No diagnostic report yet.'}</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <div className="desktop-app-launcher__actions">
        <button type="button" className="secondary-action" disabled={busy !== null} onClick={() => void refresh()}>
          {busy === 'checking' ? 'Checking…' : 'Refresh status'}
        </button>
        <button type="button" className="secondary-action" disabled={busy !== null || !report?.configured} onClick={() => void validate()}>
          {busy === 'validating' ? 'Loading model…' : 'Validate local model'}
        </button>
      </div>
      <small>
        A loadable model is not proof of accurate “BOZZ” detection. A trained BOZZ classifier and labelled audio
        evaluation are still required. Background listening remains unavailable in this build.
      </small>
    </section>
  )
}
