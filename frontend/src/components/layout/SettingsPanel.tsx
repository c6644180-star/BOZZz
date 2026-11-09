import { ArrowUpRight, Camera, FolderOpen, Hand, Mic, MonitorCog, Volume2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { useHgi } from '../hgi/hgiContext'
import { AppearanceSettings } from '../settings/AppearanceSettings'
import { MiniOrbSettings } from '../settings/MiniOrbSettings'
import { ModulePermissions } from '../settings/ModulePermissions'
import type { ConnStatus } from '../../types/bozz'

export function SettingsPanel({ backend, onClose }: { backend: ConnStatus; onClose: () => void }) {
  const { settings, updateSettings, tts, ttsServer, mic, ai } = useBozzVoice()
  const hgi = useHgi()
  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  return (
    <div className="settings-panel">
      <section className="settings-group" aria-label="Preferences">
        <label className="toggle-row">
          <span>
            Speak replies aloud
            <small>ElevenLabs when configured; browser voice as fallback</small>
          </span>
          <input
            type="checkbox"
            checked={settings.voiceOutput}
            onChange={(event) => updateSettings({ voiceOutput: event.target.checked })}
            disabled={!tts.available}
          />
        </label>
        <label className="toggle-row">
          <span>
            Show captions
            <small>Floating reply text under the orb while BOZZ speaks</small>
          </span>
          <input
            type="checkbox"
            checked={settings.captions}
            onChange={(event) => updateSettings({ captions: event.target.checked })}
          />
        </label>
      </section>

      <section className="settings-group" aria-label="Hands-free voice">
        <h3>Hands-free voice input</h3>
        <label className="toggle-row">
          <span>
            Push-to-talk key
            <small>Hold the key to listen; release to send. Typing fields are ignored.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.pushToTalk}
            onChange={(event) => updateSettings({ pushToTalk: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>
            Push-to-talk shortcut
            <small>Used while push-to-talk is on</small>
          </span>
          <select
            value={settings.pushToTalkKey}
            onChange={(event) => updateSettings({ pushToTalkKey: event.target.value as typeof settings.pushToTalkKey })}
            disabled={!settings.pushToTalk}
          >
            <option value="Space">Space</option>
            <option value="Control+Space">Ctrl + Space</option>
            <option value="Alt+Space">Alt + Space</option>
          </select>
        </label>
        <label className="toggle-row">
          <span>
            Wake word “BOZZ”
            <small>Keeps listening after the microphone is turned on and ignores speech until it hears “BOZZ …”.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.wakeWord}
            onChange={(event) => updateSettings({ wakeWord: event.target.checked })}
          />
        </label>
      </section>

      <AppearanceSettings />

      <MiniOrbSettings />

      <section className="settings-group" id="module-permissions" aria-label="Module permissions">
        <ModulePermissions variant="compact" />
      </section>

      <section className="settings-group" aria-label="Sensor and service status">
        <h3>Status</h3>
        <dl className="quick-status">
          <div>
            <dt>Backend</dt>
            <dd>{backend === 'online' ? 'Online' : backend === 'checking' ? 'Checking…' : 'Offline'}</dd>
          </div>
          <div>
            <dt>Local AI</dt>
            <dd>{ai.available ? `${ai.provider} · ${ai.configuredModel}` : `Unavailable — ${ai.detail ?? 'checking'}`}</dd>
          </div>
          <div>
            <dt><Volume2 />Speech output</dt>
            <dd>
              {ttsServer.configured
                ? `ElevenLabs · ${ttsServer.model}`
                : `Browser voice${tts.available ? '' : ' unsupported'} — ${ttsServer.detail ?? 'ElevenLabs not configured'}`}
            </dd>
          </div>
          <div>
            <dt><Mic />Microphone</dt>
            <dd>{mic.available ? (mic.listening ? 'Listening now' : 'Available on request') : 'Unsupported'}</dd>
          </div>
          <div>
            <dt><Camera />Camera</dt>
            <dd>{cameraSupported ? (hgi.metrics.cameraActive ? 'Active — gesture engine' : 'Available on request') : 'Unsupported'}</dd>
          </div>
          <div>
            <dt><Hand />Gestures</dt>
            <dd>{hgi.enabled ? `Running · ${hgi.metrics.fps} fps` : 'Off — camera released'}</dd>
          </div>
          <div>
            <dt><MonitorCog />Desktop control</dt>
            <dd>
              {hgi.desktopState}
              {hgi.desktopEnabled ? ` · ${hgi.desktopConnection}` : ''}
              {hgi.desktopPermissionGranted ? '' : ' · permission not granted'}
            </dd>
          </div>
        </dl>
        <p className="panel-note">Sensors only activate after a browser permission prompt. Nothing is recorded or uploaded.</p>
      </section>

      <button
        type="button"
        className="settings-link"
        onClick={() => {
          window.dispatchEvent(new Event('bozz:open-desktop'))
          onClose()
        }}
      >
        <span><MonitorCog /> Desktop Control · {hgi.desktopState}</span>
        <ArrowUpRight />
      </button>
      <Link className="settings-link" to="/settings#file-access" onClick={onClose}>
        <span><FolderOpen /> File access</span>
        <ArrowUpRight />
      </Link>
      <Link className="settings-link" to="/gesture" onClick={onClose}>
        <span><Hand /> Gesture Lab</span>
        <ArrowUpRight />
      </Link>
      <Link className="settings-link" to="/settings" onClick={onClose}>
        Open full settings
        <ArrowUpRight />
      </Link>
    </div>
  )
}
