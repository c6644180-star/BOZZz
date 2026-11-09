import { Hand, MonitorCog, OctagonAlert, Pause, ShieldCheck, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AskBar } from '../chat/AskBar'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { useHgi } from '../hgi/hgiContext'

const suggestions = ['System status', 'Open my projects', 'What can you do?']

export function GlobalCommandDock() {
  const navigate = useNavigate()
  const { mic, pauseInteraction, submit } = useBozzVoice()
  const { desktopState, desktopEnabled } = useHgi()

  function emergencyStop() {
    pauseInteraction('Emergency stop activated. Voice, camera, gestures, and desktop control are stopped.')
    window.dispatchEvent(new Event('bozz-emergency-stop'))
  }

  return (
    <section className="global-command-dock" aria-label="Universal BOZZ command interface">
      <div className="global-control-strip">
        <span className={`desktop-control-lock ${desktopEnabled ? 'is-on' : ''}`}>
          <ShieldCheck /> DESKTOP {desktopState.toUpperCase()} <small>approval per Tier 2 action</small>
        </span>
        <span className={mic.listening ? 'global-voice-state active' : 'global-voice-state'}>{mic.listening ? 'VOICE LISTENING' : mic.available ? 'VOICE READY' : 'VOICE UNAVAILABLE'}</span>
        <button className="gesture-shortcut" onClick={() => window.dispatchEvent(new Event('bozz:open-desktop'))}><MonitorCog /> Desktop</button>
        <button className="gesture-shortcut" onClick={() => navigate('/gesture')}><Hand /> Gesture Lab</button>
        <button className="pause-control" onClick={() => pauseInteraction('BOZZ interaction paused.')}><Pause /> Pause</button>
        <button className="emergency-control" onClick={emergencyStop}><OctagonAlert /> Emergency stop</button>
      </div>
      <div className="global-command-main">
        <div className="command-suggestions" aria-label="Command suggestions">
          <Sparkles />
          {suggestions.map((suggestion) => <button key={suggestion} onClick={() => submit(suggestion)}>{suggestion}</button>)}
          <button onClick={() => window.dispatchEvent(new Event('bozz:open-desktop'))}>Desktop control status</button>
        </div>
        <AskBar className="global-ask-bar" placeholder="Ask BOZZ, review an action, or give a command..." />
      </div>
    </section>
  )
}
