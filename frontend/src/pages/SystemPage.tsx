import { Activity, Camera, Cpu, Mic, ShieldCheck, Volume2 } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'
import { MissionPanel } from '../components/panels/MissionPanel'
import { QuickActionsPanel } from '../components/panels/QuickActionsPanel'
import { SystemStatusPanel } from '../components/panels/SystemStatusPanel'
import { useHgi } from '../components/hgi/hgiContext'
import { useBozzVoice } from '../hooks/useBozzVoice'
import type { ConnStatus } from '../types/bozz'

export default function SystemPage({ status }: { status: ConnStatus }) {
  const { orbState, mic, tts } = useBozzVoice()
  const hgi = useHgi()
  const tracking = hgi.starting ? 'starting' : hgi.enabled ? `on · ${hgi.metrics.fps} fps` : 'off'
  const desktop = hgi.desktopLoadError
    ? 'backend unavailable'
    : hgi.desktopConnection === 'stopped'
      ? 'emergency stopped'
      : hgi.desktopEnabled
        ? hgi.desktopConnection
        : 'off by default'

  return (
    <ModulePage
      title="System"
      subtitle="Status, sensors, and quick actions that used to sit around the orb. Everything here reports a real capability check."
      tone={status === 'offline' ? 'preview' : 'live'}
    >
      <div className="system-grid">
        <SystemStatusPanel status={status} />
        <QuickActionsPanel />
        <MissionPanel />
        <section className="edge-panel system-link-panel">
          <div className="panel-title">
            <span><i className={`dot-${status}`} /> Intelligence link</span>
            <b className={status === 'online' ? 'is-ok' : 'is-warn'}>{orbState}</b>
          </div>
          <div className="system-rows">
            <span><Cpu /> Local backend <b>{status}</b></span>
            <span><Mic /> Voice input <b>{mic.listening ? 'listening' : mic.available ? 'available' : 'unavailable'}</b></span>
            <span><Volume2 /> Speech output <b>{tts.available ? 'available' : 'unavailable'}</b></span>
            <span><Camera /> Hand tracking <b>{tracking}</b></span>
            <span><ShieldCheck /> Desktop mouse <b>{desktop}</b></span>
          </div>
          <p className="workflow-note">
            Hand tracking uses local MediaPipe landmarks. Desktop mouse control is opt-in, mouse-only, and off until you enable it in Gesture Lab.
          </p>
        </section>
      </div>
      <p className="system-hint">
        <Activity /> The orb animates only for real states: idle, listening, thinking, speaking, error, and offline.
      </p>
    </ModulePage>
  )
}
