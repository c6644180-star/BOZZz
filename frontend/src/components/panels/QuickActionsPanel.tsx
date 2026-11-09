import { useNavigate } from 'react-router-dom'
import { ArrowRight, BrainCircuit, Camera, Folder, Hand, Home, Smartphone } from 'lucide-react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { useHgi } from '../hgi/hgiContext'

export function QuickActionsPanel() {
  const navigate = useNavigate()
  const { setCaption } = useBozzVoice()
  const hgi = useHgi()
  return (
    <section className="edge-panel actions-panel">
      <div className="panel-title"><span><b className="bolt">ϟ</b> Quick Actions</span><ArrowRight /></div>
      <div className="action-grid">
        <button onClick={() => navigate('/projects')}><Folder />Open Projects</button>
        <button onClick={() => setCaption('Screenshot capture needs a connected system service.') }><Camera />Take Screenshot</button>
        <button onClick={() => navigate('/devices')}><Home />Control Devices</button>
        <button onClick={() => navigate('/memory')}><BrainCircuit />View Memory</button>
        <button onClick={() => navigate('/devices')}><Smartphone />Pair Device</button>
        <button onClick={() => navigate('/gesture')}><Hand />{hgi.enabled ? `Gestures · ${hgi.mode}` : 'Gesture Control'}</button>
      </div>
    </section>
  )
}
