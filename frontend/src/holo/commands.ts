import { addHistoryEntry, uid } from '../services/localStore'
import { findFiles, type FileEntry, type FindTask } from '../services/files'
import { getHoloModel } from './modelControl'
import { navigateToHolo, setPendingFolder } from './holoBridge'

export interface HoloControlResult {
  ok: boolean
  reply: string
}

export interface HoloControlState {
  root: string | null
  expanded: string[]
}

export interface HoloControlApi {
  expand(name: string): HoloControlResult
  collapse(name?: string): HoloControlResult
  openNamed(name: string): HoloControlResult
  back(): HoloControlResult
  resetView(): HoloControlResult
  filterImages(on: boolean): HoloControlResult
  zoom(factor: number): HoloControlResult
  getState(): HoloControlState
}

let activeControl: HoloControlApi | null = null
const controlListeners = new Set<() => void>()

export function registerHoloControl(api: HoloControlApi): () => void {
  activeControl = api
  controlListeners.forEach((listener) => listener())
  return () => {
    if (activeControl === api) {
      activeControl = null
      controlListeners.forEach((listener) => listener())
    }
  }
}

export function getHoloControl(): HoloControlApi | null {
  return activeControl
}

export type ParsedHoloCommand =
  | { kind: 'show' }
  | { kind: 'open-folder'; query: string; label: string }
  | { kind: 'expand'; name: string }
  | { kind: 'collapse'; name?: string }
  | { kind: 'open'; name: string }
  | { kind: 'back' }
  | { kind: 'reset' }
  | { kind: 'filter'; on: boolean }
  | { kind: 'zoom'; factor: number }

export function cleanFolderQuery(raw: string): string {
  return raw
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\b(?:my|the|folder|folders|please)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseHoloCommand(text: string, hasControl: boolean): ParsedHoloCommand | null {
  const command = text.trim().replace(/[.!?]+$/, '').trim()
  if (!command) return null

  if (/^(?:show|open|go to)(?: the)? (?:holographic|holo)(?: projects?| workspace)?$/i.test(command)
    || /^(?:show|open|go to)(?: the)? hologram$/i.test(command)) {
    return { kind: 'show' }
  }

  const folder = command.match(/^open (?:my|the) (.+?) folders?$/i)
    ?? command.match(/^open folders? (.+)$/i)
  if (folder) {
    const query = cleanFolderQuery(folder[1])
    if (query) return { kind: 'open-folder', query, label: `folder ${query}` }
  }

  const expand = command.match(/^expand(?: the)? (.+)$/i)
  if (expand) {
    const name = expand[1].replace(/\s+(?:folder|node)$/i, '').trim()
    if (name) return { kind: 'expand', name }
  }
  const collapse = command.match(/^collapse(?: (?:the )?(.+))?$/i)
  if (collapse) {
    const name = collapse[1]?.replace(/\s+(?:folder|node)$/i, '').trim()
    return name ? { kind: 'collapse', name } : { kind: 'collapse' }
  }
  if (hasControl) {
    const open = command.match(/^open (.+)$/i)
    if (open) {
      const name = open[1].trim()
      if (name) return { kind: 'open', name }
    }
  }
  if (/^(?:go )?back$|^up one level$|^go up$/i.test(command)) return { kind: 'back' }
  if (/^reset(?: the)? (?:view|camera)$|^reset$/i.test(command)) return { kind: 'reset' }
  if (/^show only images$|^only images$|^images only$/i.test(command)) {
    return { kind: 'filter', on: true }
  }
  if (/^show all(?: files)?$|^clear (?:the )?filter$/i.test(command)) {
    return { kind: 'filter', on: false }
  }
  if (/^zoom in$/i.test(command)) return { kind: 'zoom', factor: 1.2 }
  if (/^zoom out$/i.test(command)) return { kind: 'zoom', factor: 0.8 }
  return null
}

type ParsedHoloModelCommand =
  | { kind: 'hide'; name: string }
  | { kind: 'isolate'; name: string }
  | { kind: 'show-all' }
  | { kind: 'hologram-mode' }

function parseHoloModelCommand(text: string): ParsedHoloModelCommand | null {
  const command = text.trim().replace(/[.!?]+$/, '').trim()
  const hide = command.match(/^hide part (.+)$/i)
  if (hide) return { kind: 'hide', name: hide[1].trim() }
  const isolate = command.match(/^isolate part (.+)$/i)
  if (isolate) return { kind: 'isolate', name: isolate[1].trim() }
  if (/^show all parts$/i.test(command)) return { kind: 'show-all' }
  if (/^hologram mode$/i.test(command)) return { kind: 'hologram-mode' }
  return null
}

function describeMatches(matches: FileEntry[]): string {
  return matches
    .slice(0, 3)
    .map((entry) => `"${entry.name}"`)
    .join(', ')
}

function record(title: string, status: 'done' | 'failed', href = '/projects'): void {
  addHistoryEntry({
    id: uid(),
    title: title.length > 90 ? `${title.slice(0, 87)}…` : title,
    kind: 'task',
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    href,
  })
}

async function openFolder(query: string, label: string): Promise<{ reply: string }> {
  let task: FindTask
  try {
    task = await findFiles(query, { label: `Holographic Projects: ${label}`, kind: 'folder', limit: 8 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The local folder search failed.'
    record(`Holo folder search: ${label}`, 'failed')
    return { reply: `${detail} Nothing was opened.` }
  }

  const matches = task.matches ?? []
  record(
    `Holo folder search: ${label}`,
    task.status === 'reported' ? 'done' : 'failed',
    `/intent-map?intent=${encodeURIComponent(task.id)}`,
  )
  setPendingFolder({
    query,
    label,
    taskId: task.id,
    matches,
    note: task.message,
  })
  navigateToHolo()

  if (matches.length === 0) {
    return {
      reply: `I found no folder matching "${query}" in the folders you allow. Nothing was opened.`,
    }
  }
  if (matches.length === 1) {
    return {
      reply: `Found "${matches[0].name}". Opening it in Holographic Projects. This is a read-only 3D view; nothing was changed.`,
    }
  }
  return {
    reply: `Found ${matches.length} folders: ${describeMatches(matches)}. Choose one in Holographic Projects. Nothing has been opened.`,
  }
}

export async function runHoloCommand(text: string): Promise<{ reply: string } | null> {
  const modelApi = getHoloModel()
  const modelCommand = parseHoloModelCommand(text)
  if (modelCommand) {
    if (!modelApi) {
      return { reply: 'Open a .glb or .gltf in Holographic Projects before using model part commands. Nothing was changed.' }
    }
    let result: import('../l3dme/modelControl').ModelControlResult
    if (modelCommand.kind === 'hide') result = modelApi.hidePart(modelCommand.name)
    else if (modelCommand.kind === 'isolate') result = modelApi.isolatePart(modelCommand.name)
    else if (modelCommand.kind === 'show-all') result = modelApi.showAllParts()
    else result = modelApi.setHoloMode('hologram')
    record(`Holo model: ${modelCommand.kind}`, result.ok ? 'done' : 'failed')
    return { reply: result.detail }
  }

  const control = getHoloControl()
  const parsed = parseHoloCommand(text, Boolean(control))
  if (!parsed) return null

  if (parsed.kind === 'show') {
    navigateToHolo()
    record('Holographic Projects', 'done')
    return {
      reply: 'Opening Holographic Projects. It is a read-only 3D scene on the monitor, not a real hologram.',
    }
  }

  if (parsed.kind === 'open-folder') {
    return openFolder(parsed.query, parsed.label)
  }

  if (!control) {
    return {
      reply: 'Holographic Projects is not open. Open it from the menu first. Nothing was changed.',
    }
  }

  let result: HoloControlResult
  if (parsed.kind === 'expand') result = control.expand(parsed.name)
  else if (parsed.kind === 'collapse') result = control.collapse(parsed.name)
  else if (parsed.kind === 'open') result = control.openNamed(parsed.name)
  else if (parsed.kind === 'back') result = control.back()
  else if (parsed.kind === 'reset') result = control.resetView()
  else if (parsed.kind === 'filter') result = control.filterImages(parsed.on)
  else result = control.zoom(parsed.factor)

  record(`Holographic Projects: ${parsed.kind}`, result.ok ? 'done' : 'failed')
  return { reply: result.reply }
}
