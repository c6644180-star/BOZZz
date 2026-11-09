import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { loadProjects, onLocalStoreChange } from '../../services/localStore'
import type { ProjectTask } from '../../types/bozz'

export function MissionPanel() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<ProjectTask[]>(() => loadProjects())
  useEffect(() => onLocalStoreChange(() => setTasks(loadProjects())), [])

  const remaining = tasks.filter((t) => !t.done).length
  const done = tasks.length - remaining
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : null

  return (
    <section className="edge-panel mission-panel">
      <div className="panel-title">
        <span><b className="star">★</b> Mission Panel</span>
        <small onClick={() => navigate('/projects')}>View All <ArrowRight /></small>
      </div>
      <div className="mission-content">
        <div className="mission-ring" style={{ '--mission-pct': pct ?? 0 } as CSSProperties}>
          <strong>{pct !== null ? `${pct}%` : '--'}</strong>
          {pct !== null && <span>complete</span>}
        </div>
        <div>
          {tasks.length > 0 ? (
            <>
              <strong>{remaining > 0 ? 'Complete your project' : 'Mission complete'}</strong>
              <span>{remaining > 0 ? `${remaining} task${remaining === 1 ? '' : 's'} remaining` : `${done} tasks done — saved on this device`}</span>
            </>
          ) : (
            <>
              <strong>No active mission</strong>
              <span>Add tasks in Projects to track real progress.</span>
            </>
          )}
          <div className="mission-line"><i style={{ width: `${pct ?? 0}%` }} /></div>
          <em>“Dream. Plan. Create.” — BOZZ</em>
        </div>
      </div>
    </section>
  )
}
