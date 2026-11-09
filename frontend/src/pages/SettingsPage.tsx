import { ModulePage } from '../components/layout/ModulePage'
import { AppearanceSettings } from '../components/settings/AppearanceSettings'
import { MiniOrbSettings } from '../components/settings/MiniOrbSettings'
import { ModulePermissions } from '../components/settings/ModulePermissions'
import { FileAccessSettings } from '../components/settings/FileAccessSettings'
import { MessageSettings } from '../components/settings/MessageSettings'
import { useBozzVoice } from '../hooks/useBozzVoice'
import { useHgi } from '../components/hgi/hgiContext'
import { probeBackend } from '../services/backend'
import { VOICE_MODE_COPY } from '../adaptive/voice'
import { WAKE_WORD_NOT_INSTALLED } from '../adaptive/wakeWord'
import { ReliabilitySettings } from '../components/settings/ReliabilitySettings'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ConnStatus, VoiceMode } from '../types/bozz'

export default function SettingsPage() {
  const { settings, updateSettings, tts, mic, ai } = useBozzVoice()
  const hgi = useHgi()
  const [backend, setBackend] = useState<ConnStatus>('checking')
  useEffect(() => {
    let alive = true
    void probeBackend().then((s) => { if (alive) setBackend(s) })
    return () => { alive = false }
  }, [])

  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  return (
    <ModulePage title="Settings" subtitle="Preferences are stored on this device. Every status below reflects a real capability check." tone="live">
      <div className="settings-grid">
        <label className="toggle-row">
          <span>Speak replies aloud<small>ElevenLabs when configured; browser voice as fallback</small></span>
          <input type="checkbox" checked={settings.voiceOutput} onChange={(e) => updateSettings({ voiceOutput: e.target.checked })} disabled={!tts.available} />
        </label>
        <label className="toggle-row">
          <span>Show captions<small>Floating reply text under the orb while BOZZ speaks</small></span>
          <input type="checkbox" checked={settings.captions} onChange={(e) => updateSettings({ captions: e.target.checked })} />
        </label>
        <label className="toggle-row">
          <span>Push-to-talk key<small>Hold to listen, release to send. Ignored inside typing fields.</small></span>
          <input type="checkbox" checked={settings.pushToTalk} onChange={(e) => updateSettings({ pushToTalk: e.target.checked })} />
        </label>
        <label className="toggle-row">
          <span>Push-to-talk shortcut<small>Used while push-to-talk is on</small></span>
          <select
            value={settings.pushToTalkKey}
            onChange={(e) => updateSettings({ pushToTalkKey: e.target.value as typeof settings.pushToTalkKey })}
            disabled={!settings.pushToTalk}
          >
            <option value="Space">Space</option>
            <option value="Control+Space">Ctrl + Space</option>
            <option value="Alt+Space">Alt + Space</option>
          </select>
        </label>
        <label className="toggle-row">
          <span>
            Voice input mode
            <small>{VOICE_MODE_COPY[settings.voiceMode].detail}</small>
          </span>
          <select
            value={settings.voiceMode}
            onChange={(e) => updateSettings({ voiceMode: e.target.value as VoiceMode, wakeWord: e.target.value === 'wake-word' })}
          >
            {(Object.keys(VOICE_MODE_COPY) as VoiceMode[]).map((mode) => (
              <option key={mode} value={mode}>{VOICE_MODE_COPY[mode].label}</option>
            ))}
          </select>
        </label>
        {settings.voiceMode === 'wake-word' && (
          <p className="settings-note">{WAKE_WORD_NOT_INSTALLED} Choosing this mode now falls back to push-to-talk.</p>
        )}
        <label className="toggle-row">
          <span>Ask “Did you say…?” when confidence is low<small>Speak yes/no or use the on-screen buttons. Nothing runs until you answer.</small></span>
          <input type="checkbox" checked={settings.confirmLowConfidence} onChange={(e) => updateSettings({ confirmLowConfidence: e.target.checked })} />
        </label>
        <label className="toggle-row">
          <span>Save command text in diagnostics<small>Off by default. Only uncertain or corrected commands are logged, never audio.</small></span>
          <input type="checkbox" checked={settings.logCommandText} onChange={(e) => updateSettings({ logCommandText: e.target.checked })} />
        </label>
        <ReliabilitySettings />
        <AppearanceSettings />
        <MiniOrbSettings />
        <section id="module-permissions" className="settings-module-permissions">
          <ModulePermissions variant="full" />
        </section>
        <FileAccessSettings />
        <MessageSettings />
        <div className="status-rows">
          <p><strong>Backend (/api/health):</strong> {backend === 'online' ? 'online' : backend === 'checking' ? 'checking…' : 'offline — no backend connection'}</p>
          <p><strong>Local AI:</strong> {ai.available ? `${ai.provider} · ${ai.configuredModel}` : `unavailable — ${ai.detail ?? 'checking…'}`}</p>
          <p><strong>Speech output:</strong> {tts.available ? 'available in this browser' : 'not supported in this browser'}</p>
          <p><strong>Voice input:</strong> {mic.available ? 'available in this browser' : `not supported${mic.reason ? ` (${mic.reason})` : ''}`}</p>
          <p><strong>Camera:</strong> {cameraSupported ? 'supported — only active after you grant permission in Gesture Lab' : 'not available in this browser'}</p>
          <p>
            <strong>Gesture tracking:</strong>{' '}
            {hgi.starting
              ? 'starting the camera…'
              : hgi.enabled
                ? `running · ${hgi.metrics.fps} fps · ${hgi.metrics.hands} hand${hgi.metrics.hands === 1 ? '' : 's'} · ${hgi.metrics.currentGesture ?? 'no gesture'}`
                : 'off — camera released'}{' '}
            <Link to="/gesture">open Gesture Lab</Link>
          </p>
          <p><strong>Desktop mouse control:</strong> {hgi.desktopState} — local backend only · {hgi.desktopPermissionGranted ? 'device control granted' : 'device control NOT granted'}</p>
          <p><strong>Pending desktop approvals:</strong> {hgi.desktopApprovals.length}</p>
          <p><strong>Last desktop action:</strong> {hgi.desktopActions[0] ? `${hgi.desktopActions[0].label} · ${hgi.desktopActions[0].status}` : 'nothing has run yet'}</p>
          <p>
            <button type="button" className="secondary-action" onClick={() => window.dispatchEvent(new Event('bozz:open-desktop'))}>
              Open Desktop Control panel
            </button>
          </p>
        </div>
      </div>
    </ModulePage>
  )
}
