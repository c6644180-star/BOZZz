export type ModuleStatus = 'Not connected' | 'Simulation' | 'Ready' | 'Error'

export type PermissionId =
  | 'file_access'
  | 'message_data'
  | 'camera'
  | 'microphone'
  | 'device_control'
  | 'messaging'
  | 'network'

export type Risk = 'low' | 'medium' | 'high'

export interface PermissionCatalogItem {
  id: PermissionId
  label: string
  description: string
  scope: string
  risk: Risk
}

export interface ModulePermission extends PermissionCatalogItem {
  granted: boolean
  enforced: boolean
}

export interface ModuleInfo {
  id: string
  name: string
  version: string
  status: ModuleStatus
  description: string
  statusDetail: string
  route: string | null
  capabilities: string[]
  permissions: ModulePermission[]
  errors: string[]
}

export interface ModuleError {
  module: string
  title: string
  detail: string
  createdAt: string | null
  outcome: string
}

export interface ModulesSnapshot {
  registryVersion: string
  modules: ModuleInfo[]
  permissions: PermissionCatalogItem[]
  errors: ModuleError[]
}

export type PermissionMirror = Record<string, Record<string, boolean>>

export type TaskStageStatus = 'pending' | 'running' | 'done' | 'blocked' | 'error' | 'skipped'

export interface TaskStage {
  step: string
  status: TaskStageStatus
  detail: string
  at: string | null
}

export interface TaskEvidence {
  action?: number
  ok: boolean
  detail: string
  source: string
}

export interface TaskError {
  stage: string
  detail: string
}

export interface FrontendIntentTask {
  id: string
  module: string
  text: string
  status: 'completed' | 'failed' | 'unavailable' | 'unsupported'
  stages: TaskStage[]
  requiredPermissions: string[]
  approvalState: 'not_required' | 'pending' | 'approved' | 'rejected'
  errors: TaskError[]
  evidence: TaskEvidence[]
  doneAllowed: boolean
  createdAt: string
  updatedAt: string
}
