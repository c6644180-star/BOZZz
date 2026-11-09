import { Activity } from 'lucide-react'
import { useHgi } from './hgiContext'
import { gestureLabel } from '../../hgi/classification/builtinGestures'

export function DiagnosticsPanel() {
  const { enabled, starting, paused, metrics, mode, micAvailable, micDetail } = useHgi()

  const values: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Engine', value: starting ? 'starting' : enabled ? 'running' : 'off', note: metrics.source ?? 'no source' },
    { label: 'Camera', value: metrics.cameraActive ? 'live' : 'released', note: `permission: ${metrics.permission}` },
    { label: 'Camera → event latency', value: `${metrics.latencyMs} ms`, note: 'exponential moving average' },
    { label: 'Processing rate', value: `${metrics.fps} fps`, note: metrics.note },
    { label: 'Tracking confidence', value: metrics.trackingConfidence ? `${Math.round(metrics.trackingConfidence * 100)}%` : 'no hand' },
    { label: 'Hands visible', value: String(metrics.hands) },
    { label: 'Current gesture', value: gestureLabel(metrics.currentGesture), note: metrics.currentGesture ? `${Math.round(metrics.gestureConfidence * 100)}% confidence` : undefined },
    { label: 'Short pinches', value: String(metrics.shortPinches), note: 'below the click hold — potential false clicks' },
    { label: 'Pinch starts', value: String(metrics.pinchEvents) },
    { label: 'Frames processed', value: String(metrics.frameCount) },
    { label: 'Mode', value: mode, note: paused ? 'command output paused' : 'command output active' },
    { label: 'Quality cap', value: metrics.quality },
    { label: 'Microphone gate', value: micAvailable ? 'on (loudness only)' : 'off', note: micDetail ?? 'clap stays low-confidence without it' },
  ]

  return (
    <div className="hgi-card">
      <div className="hgi-card__head">
        <h3><Activity /> Diagnostics</h3>
        <span className={`hgi-chip ${enabled ? 'is-live' : ''}`}>{enabled ? 'REAL-TIME' : 'IDLE'}</span>
      </div>
      <dl className="hgi-diagnostics">
        {values.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}{item.note ? <small>{item.note}</small> : null}</dd>
          </div>
        ))}
      </dl>
      <p className="hgi-card__note">
        Every value above comes from the running pipeline. On an i3 with integrated graphics, medium quality caps
        inference at 15 fps so the orb, chat, and voice work stay smooth. If the measured rate sits below the cap,
        close other camera or video apps.
      </p>
    </div>
  )
}
