import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  approveAgentPlan,
  approveAgentStep,
  cancelAgentTask,
  createAgentTask,
  emergencyStopAgent,
  fetchAgentStatus,
  fetchAgentTask,
  pauseAgentTask,
  rejectAgentPlan,
  resumeAgentTask,
  updateAgentSettings,
} from './api'
import { isTerminalState } from './state'
import type { AgentSettings, AgentStatus, AgentTask, AgentTaskSummary } from './types'

export interface AgentStartOptions {
  dryRun?: boolean | null
  allowScreenshots?: boolean
  screenshotProvider?: string | null
}

interface AgentContextValue {
  status: AgentStatus | null
  task: AgentTask | null
  tasks: AgentTaskSummary[]
  error: string | null
  busy: string | null
  watching: boolean
  watch: (value: boolean) => void
  refresh: () => Promise<void>
  openPanel: () => void
  setEnabled: (enabled: boolean) => Promise<void>
  patchSettings: (
    patch: Partial<AgentSettings> & { reset_emergency?: boolean },
    confirm?: boolean,
  ) => Promise<void>
  resetEmergency: () => Promise<void>
  startTask: (text: string, options?: AgentStartOptions) => Promise<AgentTask | null>
  selectTask: (taskId: string) => Promise<void>
  approvePlan: () => Promise<void>
  rejectPlan: (reason?: string) => Promise<void>
  approveStep: (approve: boolean) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
  emergencyStop: (reason?: string) => Promise<void>
}

const AgentContext = createContext<AgentContextValue | null>(null)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The computer agent request failed.'
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [task, setTaskState] = useState<AgentTask | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const taskRef = useRef<AgentTask | null>(null)

  const setTask = useCallback((next: AgentTask | null) => {
    taskRef.current = next
    setTaskState(next)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAgentStatus()
      setStatus(next)
      setError(null)
      if (next.active_task) {
        taskRef.current = next.active_task
        setTaskState(next.active_task)
        return
      }
      const current = taskRef.current
      if (current && !isTerminalState(current.state)) {
        try {
          const latest = await fetchAgentTask(current.id)
          taskRef.current = latest
          setTaskState(latest)
        } catch {
          // The status call already succeeded; a single task refresh can retry next tick.
        }
      }
    } catch (caught) {
      setError(messageOf(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (watching) void refresh()
  }, [watching, refresh])

  const taskId = task?.id ?? null
  const taskState = task?.state ?? null
  useEffect(() => {
    if (!taskId || !taskState || isTerminalState(taskState)) return
    let alive = true
    const controller = new AbortController()
    const tick = async () => {
      try {
        const latest = await fetchAgentTask(taskId, controller.signal)
        if (!alive) return
        taskRef.current = latest
        setTaskState(latest)
        if (isTerminalState(latest.state)) void refresh()
      } catch (caught) {
        if (!alive) return
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(messageOf(caught))
      }
    }
    const timer = window.setInterval(() => void tick(), 1200)
    return () => {
      alive = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [taskId, taskState, refresh])

  const withBusy = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<T | null> => {
    setBusy(key)
    try {
      const value = await action()
      setError(null)
      return value
    } catch (caught) {
      setError(messageOf(caught))
      return null
    } finally {
      setBusy(null)
    }
  }, [])

  const setEnabled = useCallback(
    (enabled: boolean) =>
      withBusy('settings', async () => {
        await updateAgentSettings({ enabled }, enabled)
        await refresh()
      }).then(() => undefined),
    [refresh, withBusy],
  )

  const patchSettings = useCallback(
    (patch: Partial<AgentSettings> & { reset_emergency?: boolean }, confirm = false) =>
      withBusy('settings', async () => {
        await updateAgentSettings(patch, confirm)
        await refresh()
      }).then(() => undefined),
    [refresh, withBusy],
  )

  const resetEmergency = useCallback(
    () =>
      withBusy('settings', async () => {
        await updateAgentSettings({ reset_emergency: true }, true)
        await refresh()
      }).then(() => undefined),
    [refresh, withBusy],
  )

  const startTask = useCallback(
    async (text: string, options: AgentStartOptions = {}) => {
      const trimmed = text.trim()
      if (!trimmed) return null
      const current = taskRef.current
      if (current && !isTerminalState(current.state)) {
        setError('The agent is already running a task. Stop it before starting another.')
        return null
      }
      return withBusy('start', async () => {
        const created = await createAgentTask(trimmed, options)
        taskRef.current = created
        setTaskState(created)
        if (isTerminalState(created.state)) void refresh()
        return created
      })
    },
    [refresh, withBusy],
  )

  const selectTask = useCallback(
    (taskIdToLoad: string) =>
      withBusy('task', async () => {
        const loaded = await fetchAgentTask(taskIdToLoad)
        taskRef.current = loaded
        setTaskState(loaded)
      }).then(() => undefined),
    [withBusy],
  )

  const approvePlan = useCallback(
    () =>
      withBusy('plan', async () => {
        const current = taskRef.current
        if (!current) return
        const updated = await approveAgentPlan(current.id)
        setTask(updated)
      }).then(() => undefined),
    [setTask, withBusy],
  )

  const rejectPlan = useCallback(
    (reason = 'Rejected from the Agent panel.') =>
      withBusy('plan', async () => {
        const current = taskRef.current
        if (!current) return
        const updated = await rejectAgentPlan(current.id, reason)
        setTask(updated)
      }).then(() => undefined),
    [setTask, withBusy],
  )

  const approveStep = useCallback(
    (approve: boolean) =>
      withBusy('step', async () => {
        const current = taskRef.current
        if (!current?.pending_approval) return
        const updated = await approveAgentStep(
          current.id,
          current.pending_approval.approval_id,
          approve,
        )
        setTask(updated)
        if (isTerminalState(updated.state)) void refresh()
      }).then(() => undefined),
    [refresh, setTask, withBusy],
  )

  const pause = useCallback(
    () =>
      withBusy('pause', async () => {
        const current = taskRef.current
        if (!current) return
        setTask(await pauseAgentTask(current.id))
      }).then(() => undefined),
    [setTask, withBusy],
  )

  const resume = useCallback(
    () =>
      withBusy('resume', async () => {
        const current = taskRef.current
        if (!current) return
        setTask(await resumeAgentTask(current.id))
      }).then(() => undefined),
    [setTask, withBusy],
  )

  const cancel = useCallback(
    () =>
      withBusy('cancel', async () => {
        const current = taskRef.current
        if (!current) return
        setTask(await cancelAgentTask(current.id))
      }).then(() => undefined),
    [setTask, withBusy],
  )

  const emergencyStop = useCallback(
    (reason = 'manual') =>
      withBusy('stop', async () => {
        const next = await emergencyStopAgent(reason)
        setStatus(next)
        const current = taskRef.current
        if (current) {
          try {
            const latest = await fetchAgentTask(current.id)
            taskRef.current = latest
            setTaskState(latest)
          } catch {
            // The stop already succeeded; keep the last known task as-is.
          }
        }
      }).then(() => undefined),
    [withBusy],
  )

  const openPanel = useCallback(() => {
    window.dispatchEvent(new Event('bozz:open-agent'))
  }, [])

  const watch = useCallback((value: boolean) => setWatching(value), [])

  const emergencyRef = useRef(emergencyStop)
  emergencyRef.current = emergencyStop

  useEffect(() => {
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<AgentStartOptions & { task?: string }>).detail
      if (!detail?.task?.trim()) return
      void startTask(detail.task, detail)
    }
    const onEmergency = () => {
      const current = taskRef.current
      if (current && !isTerminalState(current.state)) void emergencyRef.current('global emergency stop')
    }
    window.addEventListener('bozz:agent-start', onStart)
    window.addEventListener('bozz:agent-emergency', onEmergency)
    window.addEventListener('bozz-emergency-stop', onEmergency)
    return () => {
      window.removeEventListener('bozz:agent-start', onStart)
      window.removeEventListener('bozz:agent-emergency', onEmergency)
      window.removeEventListener('bozz-emergency-stop', onEmergency)
    }
  }, [startTask])

  const value = useMemo<AgentContextValue>(
    () => ({
      status,
      task,
      tasks: status?.tasks ?? [],
      error,
      busy,
      watching,
      watch,
      refresh,
      openPanel,
      setEnabled,
      patchSettings,
      resetEmergency,
      startTask,
      selectTask,
      approvePlan,
      rejectPlan,
      approveStep,
      pause,
      resume,
      cancel,
      emergencyStop,
    }),
    [
      approvePlan,
      approveStep,
      busy,
      cancel,
      emergencyStop,
      error,
      openPanel,
      patchSettings,
      pause,
      refresh,
      rejectPlan,
      resetEmergency,
      resume,
      selectTask,
      setEnabled,
      startTask,
      status,
      task,
      watch,
      watching,
    ],
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

export function useAgent(): AgentContextValue {
  const value = useContext(AgentContext)
  if (!value) throw new Error('useAgent must be used inside AgentProvider.')
  return value
}
