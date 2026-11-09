import type {
  AgentReliability,
  AgentSettings,
  AgentSettingsView,
  AgentStatus,
  AgentTask,
  AgentTaskSummary,
} from './types'

const BASE = '/api/agent'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json().catch(() => null)) as { detail?: string } | T | null
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
    throw new Error(detail || `The computer agent request failed (${response.status}).`)
  }
  return body as T
}

export function fetchAgentStatus(signal?: AbortSignal): Promise<AgentStatus> {
  return request<AgentStatus>('/status', { signal })
}

export function fetchAgentSettings(): Promise<AgentSettingsView> {
  return request<AgentSettingsView>('/settings')
}

export function updateAgentSettings(patch: Partial<AgentSettings> & { reset_emergency?: boolean }, confirm = false): Promise<AgentSettingsView> {
  return request<AgentSettingsView>('/settings', {
    method: 'POST',
    body: JSON.stringify({ patch, confirm }),
  })
}

export function createAgentTask(
  task: string,
  options: { dryRun?: boolean | null; allowScreenshots?: boolean; screenshotProvider?: string | null } = {},
): Promise<AgentTask> {
  return request<AgentTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      task,
      dry_run: options.dryRun ?? null,
      allow_screenshots: options.allowScreenshots === true,
      screenshot_provider: options.screenshotProvider ?? null,
    }),
  })
}

export function listAgentTasks(limit = 20): Promise<{ tasks: AgentTaskSummary[] }> {
  return request<{ tasks: AgentTaskSummary[] }>(`/tasks?limit=${Math.max(1, Math.min(limit, 100))}`)
}

export function fetchAgentTask(taskId: string, signal?: AbortSignal): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}`, { signal })
}

export function approveAgentPlan(taskId: string): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/approve-plan`, {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  })
}

export function rejectAgentPlan(taskId: string, reason = ''): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/reject-plan`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function approveAgentStep(taskId: string, approvalId: string, approve: boolean): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/approve-step`, {
    method: 'POST',
    body: JSON.stringify({ approval_id: approvalId, approve }),
  })
}

export function pauseAgentTask(taskId: string): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/pause`, { method: 'POST', body: '{}' })
}

export function resumeAgentTask(taskId: string): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/resume`, { method: 'POST', body: '{}' })
}

export function cancelAgentTask(taskId: string, reason = 'The user cancelled the task.'): Promise<AgentTask> {
  return request<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function emergencyStopAgent(reason = 'manual'): Promise<AgentStatus> {
  return request<AgentStatus>('/emergency-stop', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function fetchAgentReliability(): Promise<AgentReliability> {
  return request<AgentReliability>('/reliability')
}

export function runAgentReliability(mode: 'engine' | 'browser', runs: number, task?: string): Promise<AgentReliability & { samples?: unknown[] }> {
  return request<AgentReliability & { samples?: unknown[] }>('/reliability/run', {
    method: 'POST',
    body: JSON.stringify({ mode, runs, task: task ?? null }),
  })
}
