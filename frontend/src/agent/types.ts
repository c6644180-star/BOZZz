export type AgentApprovalMode = 'every_step' | 'tier2'

export type AgentState =
  | 'idle'
  | 'planning'
  | 'awaiting_plan_approval'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'cancelled'

export type AgentResultLevel = 'attempted' | 'accepted' | 'completed' | 'verified' | 'none'

export type AgentStepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'verified'
  | 'executed'
  | 'attempted'
  | 'blocked'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export interface AgentSettings {
  enabled: boolean
  approval_mode: AgentApprovalMode
  ask_new_domain: boolean
  screenshot_to_provider: boolean
  dry_run: boolean
  max_steps: number
  max_seconds: number
  approval_timeout_seconds: number
  domains: string[]
}

export interface AgentSettingsView extends AgentSettings {
  emergency_stopped: boolean
}

export interface AgentActionSpec {
  id: string
  tier: number
  label: string
  risk: string
}

export interface AgentPolicy {
  approval_modes: AgentApprovalMode[]
  no_approval_mode: boolean
  tiers: Record<string, string>
  actions: AgentActionSpec[]
  domains: string[]
  test_site: string
  limits: { max_steps: number; max_seconds: number; approval_timeout_seconds: number }
}

export interface AgentAdapterInfo {
  installed?: boolean
  available?: boolean
  profile?: string
  fresh_profile?: boolean
  headed?: boolean
  detail: string
}

export interface AgentAdapters {
  browser: AgentAdapterInfo
  official_api: AgentAdapterInfo
  accessibility: AgentAdapterInfo
  desktop: AgentAdapterInfo
}

export interface AgentCapabilityProfile {
  id: string
  name: string
  version: string
  os: string
  identification: string
  documentation: string[]
  methods: string[]
  supported_actions: string[]
  common_workflows: string[]
  verification_methods: string[]
  known_limitations: string[]
  recovery: string[]
  status: 'Verified' | 'Experimental'
  status_detail: string
  required_test_suite: string | null
  last_result: AgentSuiteResult | null
  notes: string
}

export interface AgentSuiteResult {
  suite: string
  passed?: boolean
  runs?: number
  successes?: number
  success_rate?: number | null
  avg_steps?: number | null
  avg_seconds?: number | null
  failures?: string[]
  at?: string | null
  note?: string
  [key: string]: unknown
}

export interface AgentSuiteView {
  measured: boolean
  label: string
  runs: number | null
  successes: number | null
  success_rate: number | null
  avg_steps: number | null
  avg_seconds: number | null
  failures: string[]
  at: string | null
  note?: string
}

export interface AgentVerificationCheck {
  check: string
  value: string
}

export interface AgentAction {
  type: string
  params: Record<string, string | number>
}

export interface AgentPlanStep {
  id: string
  goal: string
  application: string
  method: string
  tier: number
  action: AgentAction
  expected_result: string
  dependencies: string[]
  verify: AgentVerificationCheck | null
}

export interface AgentPlan {
  task: string
  steps: AgentPlanStep[]
  notes: string[]
  planner: string
}

export interface AgentPolicyRecord {
  tier: number
  label: string
  allowed: boolean
  reason: string
  requires_approval: boolean
  needs_domain_approval: boolean
}

export interface AgentVerification {
  ok: boolean
  detail: string
  source: string
  evidence?: Record<string, unknown> | null
}

export interface AgentStep {
  id: string
  goal: string
  application: string
  method: string
  tier: number
  expected_result: string
  dependencies: string[]
  action_id: string
  verify: AgentVerificationCheck | null
  status: AgentStepStatus
  level: AgentResultLevel
  detail: string
  injection_warning: boolean
  policy: AgentPolicyRecord | null
  verification: AgentVerification | null
  started_at: string | null
  finished_at: string | null
}

export interface AgentPendingApproval {
  approval_id: string
  step_id: string
  kind: 'step' | 'domain'
  label: string
  detail: string
  tier: number
  expires_in_ms: number
  expires_at: string
}

export interface AgentReportStep {
  id: string
  status: AgentStepStatus
  level: AgentResultLevel
  detail: string
  verification: AgentVerification | null
}

export interface AgentReport {
  status: string
  summary: string
  result_level: AgentResultLevel
  verification: { ok: boolean; detail: string; source: string }
  steps: AgentReportStep[]
  elapsed_ms: number
  steps_executed: number
  injections_ignored: number
  dry_run: boolean
  provider: string
  model: string
  screenshots_shared: boolean
  notes: string[]
}

export interface AgentTaskSummary {
  id: string
  task: string
  state: AgentState
  dry_run: boolean
  provider: string | null
  model: string | null
  planner: string | null
  created_at: string
  updated_at: string
}

export interface AgentTask extends AgentTaskSummary {
  plan: AgentPlan | null
  steps: AgentStep[]
  report: AgentReport | null
  started_at: string | null
  finished_at: string | null
  elapsed_ms: number
  current_step_id: string | null
  pending_approval: AgentPendingApproval | null
  paused: boolean
  handoff: boolean
  notes: string[]
  injection_warnings: string[]
  screenshots_allowed: boolean
  screenshot_provider: string | null
  current_application: string
}

export interface AgentStatus {
  version: number
  enabled: boolean
  emergency_stopped: boolean
  settings: AgentSettings
  policy: AgentPolicy
  adapters: AgentAdapters
  method_order: string[]
  active_task: AgentTask | null
  tasks: AgentTaskSummary[]
  capabilities: AgentCapabilityProfile[]
  screenshot_policy: {
    default: boolean
    master_switch: boolean
    upload_path_exists: boolean
    notice: string
  }
}

export interface AgentReliability {
  measured: boolean
  results_dir: string
  mock_site: AgentSuiteView
  browser: AgentSuiteView
  youtube: AgentSuiteView
  history: AgentSuiteResult[]
  note: string
  engine: AgentSuiteView
  profiles: AgentCapabilityProfile[]
  adapters: { playwright_installed: boolean }
}
