import { addHistoryEntry, patchHistoryEntry, uid } from '../services/localStore'
import type { FrontendIntentTask, TaskStage } from '../types/modules'

export type ModelMode = 'solid' | 'wireframe' | 'transparent'
/** Holographic Projects reports one extra visual mode; L3DME never sets it. */
export type ModelStateMode = ModelMode | 'hologram'

export interface ModelViewerState {
  loaded: boolean
  source: string
  mode: ModelStateMode
  explode: number
  selectedPart: string | null
  parts: string[]
  cameraAzimuth: number
  cameraDistance: number
  revision: number
}

export interface ModelControlResult {
  ok: boolean
  detail: string
  verified: boolean
  evidence: string
  state: ModelViewerState
}

export interface ModelControlApi {
  rotate(degrees?: number): ModelControlResult
  zoom(factor?: number): ModelControlResult
  setMode(mode: ModelMode): ModelControlResult
  selectPart(name: string): ModelControlResult
  explode(value: number): ModelControlResult
  reset(): ModelControlResult
  getState(): ModelViewerState
}

export interface ModelCommandOutcome {
  reply: string
  task: FrontendIntentTask
}

let activeControl: ModelControlApi | null = null
const controlListeners = new Set<() => void>()

export function registerModelControl(api: ModelControlApi): () => void {
  activeControl = api
  controlListeners.forEach((listener) => listener())
  return () => {
    if (activeControl === api) {
      activeControl = null
      controlListeners.forEach((listener) => listener())
    }
  }
}

export function getModelControl(): ModelControlApi | null {
  return activeControl
}

export function subscribeModelControl(listener: () => void): () => void {
  controlListeners.add(listener)
  return () => controlListeners.delete(listener)
}

type ParsedCommand =
  | { kind: 'rotate'; degrees: number; label: string }
  | { kind: 'zoom'; factor: number; label: string }
  | { kind: 'mode'; mode: ModelMode; label: string }
  | { kind: 'reset'; label: string }
  | { kind: 'explode'; value: number; label: string }
  | { kind: 'select'; name: string; label: string }

function parseModelCommand(text: string): ParsedCommand | null {
  const command = text.trim().toLowerCase().replace(/[.!?]+$/, '').trim()
  if (/^(?:rotate|spin|turn)(?: the| my| this)?(?: 3d| model| object| view)?(?: left)?$/.test(command)) {
    return { kind: 'rotate', degrees: -15, label: 'rotate the model' }
  }
  if (/^(?:zoom|zoom in)$/.test(command)) {
    return { kind: 'zoom', factor: 1.2, label: 'zoom in' }
  }
  if (/^zoom out$/.test(command)) {
    return { kind: 'zoom', factor: 0.8, label: 'zoom out' }
  }
  if (/^(?:(?:set|switch to|show)(?: the)? )?wireframe(?: mode)?$/.test(command)) {
    return { kind: 'mode', mode: 'wireframe', label: 'wireframe mode' }
  }
  if (/^(?:(?:set|switch to|show)(?: the)? )?solid(?: mode)?$/.test(command)) {
    return { kind: 'mode', mode: 'solid', label: 'solid mode' }
  }
  if (/^(?:(?:set|switch to|show)(?: the)? )?transparent(?: mode)?$/.test(command)) {
    return { kind: 'mode', mode: 'transparent', label: 'transparent mode' }
  }
  if (/^(?:reset|restore)(?: the| my| this)?(?: 3d| model| object| view)?$/.test(command)) {
    return { kind: 'reset', label: 'reset the model' }
  }
  if (/^(?:explode|explode view|explode the model|exploded view)$/.test(command)) {
    return { kind: 'explode', value: 0.65, label: 'explode the model' }
  }
  if (/^(?:separate|explode)(?: the)? (?:components|parts)$/.test(command)) {
    return { kind: 'explode', value: 1, label: 'separate the components' }
  }
  if (/^(?:reassemble|bring (?:them|the parts|everything)(?: back)? together|bring together)$/.test(command)) {
    return { kind: 'explode', value: 0, label: 'reassemble the model' }
  }
  const select = command.match(/^(?:select|highlight) part (.+)$/)
  if (select) {
    const name = select[1].trim()
    return { kind: 'select', name, label: `select part ${name}` }
  }
  return null
}

function stages(planned: string): TaskStage[] {
  return [
    { step: 'UNDERSTAND', status: 'done', detail: 'Recognised a local L3DME view command.', at: new Date().toISOString() },
    { step: 'PLAN', status: 'done', detail: planned, at: new Date().toISOString() },
    { step: 'APPROVE', status: 'skipped', detail: 'UI-only view change; explicit approval not required.', at: new Date().toISOString() },
    { step: 'EXECUTE', status: 'running', detail: 'Running on the local model viewer.', at: new Date().toISOString() },
    { step: 'VERIFY', status: 'pending', detail: 'Waiting for viewer state evidence.', at: new Date().toISOString() },
    { step: 'REPORT', status: 'pending', detail: 'Not started.', at: new Date().toISOString() },
  ]
}

function persistTask(task: FrontendIntentTask, historyId: string): void {
  patchHistoryEntry(historyId, {
    status: task.status === 'completed' ? 'done' : 'failed',
    updatedAt: Date.now(),
    intentTask: task,
  })
}

export async function runModelCommand(text: string): Promise<ModelCommandOutcome | null> {
  const parsed = parseModelCommand(text)
  if (!parsed) return null

  const now = new Date().toISOString()
  const historyId = uid()
  const task: FrontendIntentTask = {
    id: uid(),
    module: 'l3dme',
    text: text.trim(),
    status: 'unavailable',
    stages: stages(`${parsed.label} in the local viewer.`),
    requiredPermissions: [],
    approvalState: 'not_required',
    errors: [],
    evidence: [],
    doneAllowed: false,
    createdAt: now,
    updatedAt: now,
  }

  addHistoryEntry({
    id: historyId,
    title: `L3DME: ${parsed.label}`,
    kind: 'task',
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    href: '/3d',
    intentTask: task,
  })

  const control = activeControl
  if (!control) {
    task.status = 'unsupported'
    task.stages[3] = { step: 'EXECUTE', status: 'error', detail: 'The 3D viewer is not open.', at: new Date().toISOString() }
    task.stages[4] = { step: 'VERIFY', status: 'skipped', detail: 'No viewer state to verify.', at: new Date().toISOString() }
    task.stages[5] = { step: 'REPORT', status: 'error', detail: 'Not completed; the viewer was not open.', at: new Date().toISOString() }
    task.errors = [{ stage: 'EXECUTE', detail: 'Open L3DME from the menu before issuing model commands.' }]
    task.doneAllowed = false
    task.updatedAt = new Date().toISOString()
    persistTask(task, historyId)
    return {
      reply: 'The 3D model viewer is not open. Open L3DME from the menu first. Nothing was changed.',
      task,
    }
  }

  const before = control.getState()
  if (!before.loaded) {
    task.status = 'failed'
    task.stages[3] = { step: 'EXECUTE', status: 'error', detail: 'No model is loaded.', at: new Date().toISOString() }
    task.stages[4] = { step: 'VERIFY', status: 'skipped', detail: 'No model state to verify.', at: new Date().toISOString() }
    task.stages[5] = { step: 'REPORT', status: 'error', detail: 'Not completed; load a model first.', at: new Date().toISOString() }
    task.errors = [{ stage: 'EXECUTE', detail: 'The viewer is open but no model is loaded.' }]
    task.doneAllowed = false
    task.updatedAt = new Date().toISOString()
    persistTask(task, historyId)
    return { reply: 'No 3D model is loaded. Load a file or the built-in sample first. Nothing was changed.', task }
  }

  let result: ModelControlResult
  if (parsed.kind === 'rotate') result = control.rotate(parsed.degrees)
  else if (parsed.kind === 'zoom') result = control.zoom(parsed.factor)
  else if (parsed.kind === 'mode') result = control.setMode(parsed.mode)
  else if (parsed.kind === 'reset') result = control.reset()
  else if (parsed.kind === 'explode') result = control.explode(parsed.value)
  else result = control.selectPart(parsed.name)

  const verified = result.ok && result.verified && result.evidence.trim().length > 0
  const finishedAt = new Date().toISOString()
  task.status = verified ? 'completed' : 'failed'
  task.evidence = verified
    ? [{ ok: true, detail: result.evidence, source: 'viewer_state' }]
    : []
  task.doneAllowed = verified
  task.stages[3] = {
    step: 'EXECUTE',
    status: result.ok ? 'done' : 'error',
    detail: result.detail,
    at: finishedAt,
  }
  task.stages[4] = {
    step: 'VERIFY',
    status: verified ? 'done' : 'error',
    detail: verified ? result.evidence : 'Viewer state did not confirm the requested change.',
    at: finishedAt,
  }
  task.stages[5] = {
    step: 'REPORT',
    status: verified ? 'done' : 'error',
    detail: verified ? result.detail : 'Action was not marked done because verification failed.',
    at: finishedAt,
  }
  if (!verified) {
    task.errors = [{
      stage: 'VERIFY',
      detail: result.evidence || 'Viewer state did not confirm the requested change.',
    }]
  }
  task.updatedAt = finishedAt
  persistTask(task, historyId)

  const reply = verified
    ? result.detail
    : `${result.detail} I did not mark this done because verification failed.`
  return { reply, task }
}
