import { addHistoryEntry, uid } from '../services/localStore'
import { findFiles, requestOpen, type FileEntry, type FileKind, type FindTask } from '../services/files'
import { navigateToSpatial, setPendingFind, setPendingOpen } from './spatialBridge'

export interface SpatialCommandOutcome {
  reply: string
}

type ParsedCommand =
  | { kind: 'show' }
  | { kind: 'latest'; noun: string; filter?: FileKind }
  | { kind: 'open'; query: string }
  | { kind: 'find'; query: string }

const LATEST_KINDS: Record<string, FileKind | undefined> = {
  image: 'image',
  photo: 'image',
  picture: 'image',
  video: 'video',
  pdf: 'pdf',
  markdown: 'markdown',
  document: 'text',
  file: undefined,
}

function cleanQuery(raw: string): string {
  let query = raw.trim().replace(/\b(file|folder|please)\b/gi, '').replace(/\s+/g, ' ').trim()
  if (/^project\s+/i.test(query) && query.split(/\s+/).length > 1) {
    query = query.replace(/^project\s+/i, '')
  }
  return query
}

function parseSpatialCommand(text: string): ParsedCommand | null {
  const command = text.trim().replace(/[.!?]+$/, '').trim()
  if (/^(?:show|open|go to)(?: the)? spatial(?: desktop)?(?: workspace)?$/i.test(command)) {
    return { kind: 'show' }
  }
  const latest = command.match(/^(?:show|find|get)(?: me)?(?: the)? latest (image|photo|picture|video|pdf|markdown|document|file)$/i)
  if (latest) {
    const noun = latest[1].toLowerCase()
    return { kind: 'latest', noun, filter: LATEST_KINDS[noun] }
  }
  const open = command.match(/^open (?:my|the) (.+)$/i)
  if (open) {
    const query = cleanQuery(open[1])
    if (query) return { kind: 'open', query }
  }
  const find = command.match(/^(?:find|search for|look for)(?: my| the)? (.+)$/i)
  if (find) {
    const query = cleanQuery(find[1])
    if (query) return { kind: 'find', query }
  }
  return null
}

function describeMatches(matches: FileEntry[]): string {
  return matches
    .slice(0, 3)
    .map((entry) => `"${entry.name}"`)
    .join(', ')
}

function recordTask(task: FindTask, title: string): void {
  addHistoryEntry({
    id: uid(),
    title: title.length > 90 ? `${title.slice(0, 87)}…` : title,
    kind: 'task',
    status: task.status === 'reported' ? 'done' : 'failed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    href: `/intent-map?intent=${encodeURIComponent(task.id)}`,
  })
}

function failedHistory(title: string): void {
  addHistoryEntry({
    id: uid(),
    title,
    kind: 'task',
    status: 'failed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    href: '/spatial',
  })
}

export async function runSpatialCommand(text: string): Promise<SpatialCommandOutcome | null> {
  const parsed = parseSpatialCommand(text)
  if (!parsed) return null

  if (parsed.kind === 'show') {
    navigateToSpatial()
    return { reply: 'Opening the Spatial Desktop. It only shows folders you have allowed.' }
  }

  const label = parsed.kind === 'latest' ? `latest ${parsed.noun}` : parsed.query
  const request =
    parsed.kind === 'latest'
      ? findFiles('', { label: `latest ${parsed.noun}`, kind: parsed.filter, sort: 'recent', limit: 5 })
      : findFiles(parsed.query, { label, limit: 10 })

  let task: FindTask
  try {
    task = await request
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The local search failed.'
    failedHistory(`Spatial: ${label}`)
    return { reply: `${detail} Nothing was opened.` }
  }

  recordTask(task, `Spatial: ${label}`)
  const matches = task.matches ?? []

  if (!matches.length) {
    setPendingFind({
      query: parsed.kind === 'latest' ? '' : parsed.query,
      label,
      mode: parsed.kind === 'open' ? 'open' : 'find',
      taskId: task.id,
      matches: [],
      note: task.message,
    })
    navigateToSpatial()
    return {
      reply: `I found no files matching ${parsed.kind === 'latest' ? label : `"${label}"`} in your allowed folders. Nothing was opened.`,
    }
  }

  if (parsed.kind === 'open' && matches.length === 1) {
    try {
      const intent = await requestOpen(matches[0].path)
      setPendingOpen(intent)
      navigateToSpatial()
      return {
        reply: `Found "${matches[0].name}". Approval is waiting in Spatial Desktop. I have not opened it yet.`,
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The open request failed.'
      failedHistory(`Spatial: open ${label}`)
      return { reply: `Found "${matches[0].name}", but it cannot be opened. ${detail}` }
    }
  }

  setPendingFind({
    query: parsed.kind === 'latest' ? '' : parsed.query,
    label,
    mode: parsed.kind === 'open' ? 'open' : 'find',
    taskId: task.id,
    matches,
    note: task.message,
  })
  navigateToSpatial()

  if (parsed.kind === 'open') {
    return {
      reply: `Found ${matches.length} matches: ${describeMatches(matches)}. Choose one in Spatial Desktop. Nothing has been opened.`,
    }
  }
  if (matches.length === 1) {
    return { reply: `Found "${matches[0].name}" and placed it on the Spatial Desktop.` }
  }
  return {
    reply: `Found ${matches.length} matches: ${describeMatches(matches)}. Choose one on the Spatial Desktop.`,
  }
}
