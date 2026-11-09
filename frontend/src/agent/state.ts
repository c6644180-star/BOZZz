import type {
  AgentResultLevel,
  AgentState,
  AgentStep,
  AgentStepStatus,
  AgentTask,
} from './types'

export const DEMO_TASK =
  "open the test site, search for A2D, find the newest video, open it, and prepare a comment 'Hurray!'"

export const TERMINAL_STATES: AgentState[] = ['done', 'failed', 'stopped', 'cancelled']

export const STATE_LABELS: Record<AgentState, string> = {
  idle: 'Idle',
  planning: 'Planning',
  awaiting_plan_approval: 'Awaiting plan approval',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  paused: 'Paused',
  verifying: 'Verifying',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  cancelled: 'Cancelled',
}

export const STEP_STATUS_LABELS: Record<AgentStepStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  verified: 'Verified',
  executed: 'Executed',
  attempted: 'Attempted',
  blocked: 'Blocked',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
}

export const RESULT_LEVEL_LABELS: Record<AgentResultLevel, string> = {
  none: 'Nothing run',
  attempted: 'Attempted',
  accepted: 'Accepted',
  completed: 'Completed',
  verified: 'Verified',
}

const RESULT_LEVEL_RANK: Record<AgentResultLevel, number> = {
  none: 0,
  attempted: 1,
  accepted: 2,
  completed: 3,
  verified: 4,
}

export function isTerminalState(state: AgentState): boolean {
  return TERMINAL_STATES.includes(state)
}

export function isActiveTask(task: AgentTask | null | undefined): task is AgentTask {
  return Boolean(task && !isTerminalState(task.state))
}

export function stateLabel(state: AgentState): string {
  return STATE_LABELS[state] ?? state
}

export function tierLabel(tier: number): string {
  if (tier === 1) return 'Tier 1 · read-only'
  if (tier === 2) return 'Tier 2 · approval'
  return 'Tier 3 · blocked'
}

export function tierShortLabel(tier: number): string {
  return tier === 1 ? 'T1' : tier === 2 ? 'T2' : 'T3'
}

export function resultLevelLabel(level: AgentResultLevel): string {
  return RESULT_LEVEL_LABELS[level] ?? level
}

export function resultLevelAtLeast(level: AgentResultLevel, minimum: AgentResultLevel): boolean {
  return RESULT_LEVEL_RANK[level] >= RESULT_LEVEL_RANK[minimum]
}

export function approvalModeLabel(mode: string): string {
  if (mode === 'every_step') return 'Ask before every step'
  if (mode === 'tier2') return 'Ask only for Tier 2 steps'
  return mode
}

export function agentCommandTask(text: string): string | null {
  const match = /^(?:bozz[,\s]+)?(?:do|perform|carry out)\s+(?<task>.+)$/i.exec(text.trim())
  const task = match?.groups?.task?.trim()
  return task || null
}

export function isAgentStopPhrase(text: string): boolean {
  return /^(?:bozz[,\s]+)?(?:stop|abort|cancel)\s+(?:the\s+)?(?:agent|computer agent|browser agent)$/i.test(text.trim())
    || /^(?:bozz[,\s]+)?(?:agent\s+stop|stop\s+the\s+agent)$/i.test(text.trim())
}

export function agentPausePhrase(text: string): boolean {
  return /^(?:bozz[,\s]+)?pause\s+(?:the\s+)?(?:agent|task)$/i.test(text.trim())
}

export function agentResumePhrase(text: string): boolean {
  return /^(?:bozz[,\s]+)?(?:resume|continue)\s+(?:the\s+)?(?:agent|task)$/i.test(text.trim())
}

export function verifiedCount(task: AgentTask): number {
  return task.steps.filter((step) => step.status === 'verified').length
}

export function taskProgress(task: AgentTask): number {
  if (!task.steps.length) return 0
  return Math.round((verifiedCount(task) / task.steps.length) * 100)
}

export function currentStep(task: AgentTask): AgentStep | null {
  return task.steps.find((step) => step.id === task.current_step_id) ?? null
}

export function planTierCounts(task: AgentTask): { tier1: number; tier2: number; tier3: number } {
  const steps = task.plan?.steps ?? []
  return {
    tier1: steps.filter((step) => step.tier === 1).length,
    tier2: steps.filter((step) => step.tier === 2).length,
    tier3: steps.filter((step) => step.tier >= 3).length,
  }
}

export function formatElapsed(ms: number | null | undefined): string {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${value} ms`
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function stepTarget(step: AgentStep, task: AgentTask): string {
  const planStep = task.plan?.steps.find((item) => item.id === step.id)
  if (!planStep) return step.application
  const url = planStep.action.params.url
  if (typeof url === 'string') return url
  const name = planStep.action.params.name
  if (typeof name === 'string') return name
  const field = planStep.action.params.field
  if (typeof field === 'string') return `${field}`
  const text = planStep.action.params.text
  if (typeof text === 'string') return `“${text.slice(0, 60)}”`
  return step.application
}

export function reportTone(status: string | null | undefined): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'Done') return 'success'
  if (status === 'Executed, not verified' || status === 'Dry run') return 'warning'
  if (status === 'Blocked' || status === 'Could not confirm' || status === 'Could not plan') return 'error'
  return 'info'
}
