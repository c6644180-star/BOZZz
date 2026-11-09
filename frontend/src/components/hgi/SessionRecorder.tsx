import { useEffect, useState } from 'react'
import { CircleDot, Play, Trash2, Upload } from 'lucide-react'
import { useHgi } from './hgiContext'
import { deleteSession, listSessions, saveSession, sessionDuration } from '../../hgi/storage/sessionStore'
import type { StoredSession } from '../../hgi/storage/sessionStore'
import type { ReplayResult } from '../../hgi/types'

export function SessionRecorder() {
  const {
    enabled,
    recording,
    recordingFrames,
    replaying,
    beginRecording,
    endRecording,
    replaySession,
  } = useHgi()
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [label, setLabel] = useState('')
  const [speed, setSpeed] = useState(1)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<ReplayResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      setSessions(await listSessions())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sessions could not be listed.')
    }
  }

  useEffect(() => {
    let active = true
    listSessions()
      .then((items) => {
        if (active) setSessions(items)
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Sessions could not be listed.')
      })
    return () => {
      active = false
    }
  }, [])

  async function stopAndSave() {
    const session = endRecording()
    if (!session) {
      setMessage('There was no active recording.')
      return
    }
    if (session.frames.length === 0) {
      setMessage('The recording contained no landmark frames, so nothing was saved.')
      return
    }
    try {
      const stored = await saveSession(session, label)
      setLabel('')
      setMessage(`Saved “${stored.label}” — ${session.frames.length} landmark frames, no video.`)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The session could not be saved.')
    }
  }

  async function replay(session: StoredSession) {
    setBusy(true)
    setResult(null)
    setMessage(`Replaying ${session.frames.length} frames at ${speed}×. Cursor and desktop commands stay disabled during replay.`)
    try {
      const replayResult = await replaySession(session, speed)
      setResult(replayResult)
      setMessage(`Replay finished: ${replayResult.frames} processed frames in ${replayResult.durationMs} ms.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Replay failed.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(session: StoredSession) {
    if (!window.confirm(`Delete the recorded session “${session.label}”? Only landmark numbers are removed.`)) return
    await deleteSession(session.id)
    await refresh()
    setMessage('Session deleted.')
  }

  const avgLatency = result && result.latencies.length > 0
    ? Math.round(result.latencies.reduce((sum, value) => sum + value, 0) / result.latencies.length)
    : null
  const maxLatency = result && result.latencies.length > 0 ? Math.round(Math.max(...result.latencies)) : null

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><CircleDot /> Record &amp; replay</h3>
        <span className="hgi-chip">{recording ? `${recordingFrames} FRAMES` : 'LANDMARKS ONLY'}</span>
      </div>
      <p>
        Recording stores landmark numbers and timestamps — never video. Replay feeds those numbers back through the
        same filters and classifier, which lets you compare filter settings on identical movement. Commands are
        disabled while replaying.
      </p>

      <div className="hgi-field-row">
        <label className="hgi-field">
          <span>Session label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. slow pinch test" maxLength={48} />
        </label>
        {!recording ? (
          <button type="button" className="hgi-btn hgi-btn--accent" onClick={beginRecording} disabled={!enabled || replaying}>
            <CircleDot /> Start recording
          </button>
        ) : (
          <button type="button" className="hgi-btn hgi-btn--danger" onClick={() => void stopAndSave()}>
            Stop &amp; save
          </button>
        )}
      </div>
      {recording && (
        <p className="hgi-message" role="status">
          Recording landmarks — {recordingFrames} frames captured{recordingFrames >= 3000 ? ' (3,000 frame cap reached; stop and save).' : '.'}
        </p>
      )}
      {message && <p className="hgi-message" role="status">{message}</p>}

      <div className="hgi-field-row">
        <label className="hgi-field">
          <span>Replay speed</span>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} disabled={busy}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
      </div>

      {sessions.length === 0 ? (
        <p className="hgi-card__note">No saved sessions yet.</p>
      ) : (
        <ul className="hgi-session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <div>
                <strong>{session.label}</strong>
                <small>
                  {new Date(session.createdAt).toLocaleString()} · {session.frames.length} frames · {(sessionDuration(session) / 1000).toFixed(1)} s · {session.quality}
                </small>
              </div>
              <div className="hgi-row-actions">
                <button type="button" className="hgi-btn" onClick={() => void replay(session)} disabled={busy || replaying}>
                  <Play /> Replay
                </button>
                <button type="button" className="hgi-icon-btn is-danger" onClick={() => void remove(session)} aria-label={`Delete ${session.label}`}>
                  <Trash2 />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className="hgi-replay-result">
          <strong>Replay comparison</strong>
          <dl className="hgi-mini-stats hgi-mini-stats--wide">
            <div><dt>Frames</dt><dd>{result.frames}</dd></div>
            <div><dt>Wall time</dt><dd>{result.durationMs} ms</dd></div>
            <div><dt>Avg processing</dt><dd>{avgLatency === null ? '—' : `${avgLatency} ms`}</dd></div>
            <div><dt>Max processing</dt><dd>{maxLatency === null ? '—' : `${maxLatency} ms`}</dd></div>
            <div><dt>Quality</dt><dd>{result.settings.quality}</dd></div>
            <div><dt>One Euro</dt><dd>{result.settings.minCutoff} / {result.settings.beta}</dd></div>
          </dl>
          <p className="hgi-card__note">Recognized events during this replay:</p>
          <ul className="hgi-event-list">
            {Object.keys(result.events).length === 0
              ? <li>No gesture crossed the confidence gate.</li>
              : Object.entries(result.events).map(([name, count]) => (
                <li key={name}><span>{name}</span><strong>{count}</strong></li>
              ))}
          </ul>
        </div>
      )}

      <p className="hgi-card__note"><Upload /> Sessions live in IndexedDB on this device. Nothing is uploaded.</p>
    </div>
  )
}
