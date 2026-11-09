export type IntentStatus =
  | 'unrecognized'
  | 'blocked'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'reported'
  | 'failed'

export type StepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'error' | 'skipped'

export type Risk = 'low' | 'medium' | 'high'

export interface PlanAction {
  type: string
  target: string
  description: string
  preview: string
  risk: Risk
  reversible: boolean
}

export interface WorkflowStep {
  step: string
  status: StepStatus
  detail: string
  at: string | null
}

export interface ReportAction {
  index: number
  type: string
  target: string
  ok: boolean
  detail: string
}

export interface VerificationResult {
  action: number
  ok: boolean
  detail: string
  source?: string
}

export interface TaskError {
  stage: string
  detail: string
}

export type ApprovalState = 'not_requested' | 'pending' | 'approved' | 'rejected'

export interface IntentTaskView {
  id: string
  module: string
  stages: WorkflowStep[]
  required_permissions: string[]
  approval_state: ApprovalState
  errors: TaskError[]
  verification_evidence: VerificationResult[]
  done_allowed: boolean
}

export interface IntentReport {
  summary: string
  actions: ReportAction[]
  verification: VerificationResult[]
  finished_at: string
}

export interface IntentView {
  id: string
  text: string
  status: IntentStatus
  understood: boolean
  approval_required: boolean
  approval_id: string | null
  message: string
  warnings: string[]
  examples: string[]
  actions: PlanAction[]
  steps: WorkflowStep[]
  report: IntentReport | null
  module: string
  required_permissions: string[]
  approval_state: ApprovalState
  errors: TaskError[]
  verification_evidence: VerificationResult[]
  done_allowed: boolean
  task: IntentTaskView
  created_at: string
  updated_at: string
}

export interface IntentSummary {
  id: string
  raw_text: string
  status: IntentStatus
  created_at: string
  updated_at: string
}

export interface AuditEntry {
  id: number
  intent_id: string | null
  event: string
  action_type: string | null
  target: string | null
  risk: Risk | null
  outcome: string
  detail: string
  created_at: string
}

export interface WorkspaceSummary {
  name: string
  path_hint: string
  stats: { root: string; files: number; folders: number; bytes: number }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as { detail?: string }
  if (!response.ok) {
    throw new Error(body.detail || `The workflow request failed (${response.status}).`)
  }
  return body as T
}

export const proposeIntent = (text: string) =>
  requestJson<IntentView>('/api/intents', { method: 'POST', body: JSON.stringify({ text }) })

export const approveIntent = (id: string, approvalId: string) =>
  requestJson<IntentView>(`/api/intents/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approval_id: approvalId, confirm: true }),
  })

export const executeIntent = (id: string) =>
  requestJson<IntentView>(`/api/intents/${id}/execute`, { method: 'POST' })

export const rejectIntent = (id: string, reason: string) =>
  requestJson<IntentView>(`/api/intents/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

export const getIntent = (id: string) => requestJson<IntentView>(`/api/intents/${id}`)

export const listIntents = (limit = 20) =>
  requestJson<{ intents: IntentSummary[] }>(`/api/intents?limit=${limit}`)

export const listAudit = (limit = 20) =>
  requestJson<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`)

export const fetchWorkspace = () => requestJson<WorkspaceSummary>('/api/workspace')
