import { useEffect } from 'react'
import { Bot, OctagonAlert, Pause, Play, Square } from 'lucide-react'
import { useAgent } from './AgentProvider'
import { currentStep, formatElapsed, isActiveTask, stateLabel, stepTarget } from './state'

export function AgentBanner() {
  const { task, busy, pause, resume, cancel, emergencyStop, openPanel } = useAgent()
  const active = isActiveTask(task)

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault()
        void emergencyStop('Ctrl+Alt+Q')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, emergencyStop])

  if (!active) return null

  const step = currentStep(task)
  const target = step ? stepTarget(step, task) : ''
  const canPause = !task.paused && (task.state === 'running' || task.state === 'awaiting_approval' || task.state === 'verifying')
  const canResume = task.paused || task.state === 'paused'

  return (
    <div className="agent-banner" role="alert" aria-live="assertive">
      <span className="agent-banner__dot" aria-hidden="true" />
      <Bot className="agent-banner__icon" aria-hidden="true" />
      <div className="agent-banner__text">
        <strong>Agent running: {task.task}</strong>
        <p>
          {stateLabel(task.state)}
          {step ? ` · ${step.goal}` : ''}
          {target ? ` · ${task.current_application || step?.application || 'Browser'} · ${target}` : ''}
          {' · '}
          {formatElapsed(task.elapsed_ms)}
          {task.dry_run ? ' · dry run' : ''}
        </p>
      </div>
      <div className="agent-banner__actions">
        <button type="button" className="agent-banner__button" onClick={openPanel}>
          Details
        </button>
        {canPause && (
          <button
            type="button"
            className="agent-banner__button"
            onClick={() => void pause()}
            disabled={busy !== null}
          >
            <Pause /> Pause
          </button>
        )}
        {canResume && (
          <button
            type="button"
            className="agent-banner__button"
            onClick={() => void resume()}
            disabled={busy !== null}
          >
            <Play /> Resume
          </button>
        )}
        <button
          type="button"
          className="agent-banner__button"
          onClick={() => void cancel()}
          disabled={busy !== null}
        >
          <Square /> Cancel
        </button>
        <button
          type="button"
          className="agent-banner__button is-danger"
          onClick={() => void emergencyStop('the Agent banner emergency stop')}
          disabled={busy !== null}
        >
          <OctagonAlert /> Emergency Stop
        </button>
      </div>
      <small className="agent-banner__hint">Ctrl+Alt+Q or say “BOZZ stop” stops the agent and closes its browser.</small>
    </div>
  )
}
