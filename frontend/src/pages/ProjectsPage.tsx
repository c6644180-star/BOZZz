import { useEffect, useState, type FormEvent } from 'react'
import { Check, LayoutGrid, ListTodo, Trash2 } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'
import { HoloWorkspace } from '../holo/HoloWorkspace'
import { getHoloBridge, subscribeHoloBridge } from '../holo/holoBridge'
import { loadProjects, onLocalStoreChange, pushNotification, saveProjects, uid } from '../services/localStore'
import type { ProjectTask } from '../types/bozz'

type ProjectsTab = 'hologram' | 'tasks'

export default function ProjectsPage() {
  const [tab, setTab] = useState<ProjectsTab>('hologram')
  const [tasks, setTasks] = useState<ProjectTask[]>(() => loadProjects())
  const [title, setTitle] = useState('')

  useEffect(() => onLocalStoreChange(() => setTasks(loadProjects())), [])

  useEffect(() => {
    const showHologram = () => setTab('hologram')
    window.addEventListener('bozz:holo-tab', showHologram)
    const stop = subscribeHoloBridge(() => {
      if (getHoloBridge().folder) setTab('hologram')
    })
    return () => {
      window.removeEventListener('bozz:holo-tab', showHologram)
      stop()
    }
  }, [])

  function persist(next: ProjectTask[]) {
    setTasks(next)
    saveProjects(next)
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const text = title.trim()
    if (!text) return
    persist([{ id: uid(), title: text, done: false, createdAt: Date.now() }, ...tasks])
    pushNotification(`Project task added: ${text}`)
    setTitle('')
  }

  const remaining = tasks.filter((t) => !t.done).length

  return (
    <ModulePage
      title="Projects"
      subtitle="Holographic Projects is a read-only 3D scene over the folders you allow. It is drawn on the monitor, not a real hologram. Tasks below are stored only in this browser."
      tone="local"
    >
      <div className="holo-tabs" role="tablist" aria-label="Projects views">
        <button
          type="button"
          role="tab"
          id="projects-tab-hologram"
          aria-selected={tab === 'hologram'}
          aria-controls="projects-panel-hologram"
          className={tab === 'hologram' ? 'is-active' : ''}
          onClick={() => setTab('hologram')}
        >
          <LayoutGrid /> Hologram
        </button>
        <button
          type="button"
          role="tab"
          id="projects-tab-tasks"
          aria-selected={tab === 'tasks'}
          aria-controls="projects-panel-tasks"
          className={tab === 'tasks' ? 'is-active' : ''}
          onClick={() => setTab('tasks')}
        >
          <ListTodo /> Tasks
        </button>
      </div>

      <div
        role="tabpanel"
        id="projects-panel-hologram"
        aria-labelledby="projects-tab-hologram"
        hidden={tab !== 'hologram'}
      >
        <HoloWorkspace />
      </div>

      <div
        role="tabpanel"
        id="projects-panel-tasks"
        aria-labelledby="projects-tab-tasks"
        hidden={tab !== 'tasks'}
      >
        <form className="inline-form" onSubmit={add}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task — e.g. Draft BOZZ voice spec" aria-label="New task" />
          <button type="submit">Add task</button>
        </form>
        <p className="count-line">{tasks.length === 0 ? 'No tasks yet.' : `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${remaining} remaining`}</p>
        <ul className="item-list">
          {tasks.map((task) => (
            <li key={task.id} className={task.done ? 'done' : ''}>
              <button className="check-btn" onClick={() => persist(tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))} aria-label={task.done ? 'Mark incomplete' : 'Mark complete'}><Check /></button>
              <span>{task.title}</span>
              <small>{new Date(task.createdAt).toLocaleDateString()}</small>
              <button className="delete-btn" data-gesture-guard onClick={() => persist(tasks.filter((t) => t.id !== task.id))} aria-label="Delete task"><Trash2 /></button>
            </li>
          ))}
        </ul>
      </div>
    </ModulePage>
  )
}
