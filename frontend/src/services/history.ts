import type { HistoryEntry, HistoryStatus } from '../types/bozz'
import { listIntents, type IntentStatus } from './intent'
import { loadHistory } from './localStore'

const intentStatus: Record<IntentStatus, HistoryStatus> = {
  reported: 'done',
  rejected: 'cancelled',
  failed: 'failed',
  blocked: 'failed',
  unrecognized: 'failed',
  awaiting_approval: 'running',
  approved: 'running',
}

export function loadWorkflowHistory(): Promise<HistoryEntry[]> {
  return listIntents(20).then(({ intents }) =>
    intents.map((intent) => ({
      id: `intent-${intent.id}`,
      title: intent.raw_text,
      kind: 'task' as const,
      status: intentStatus[intent.status],
      createdAt: Date.parse(intent.created_at),
      updatedAt: Date.parse(intent.updated_at),
      href: `/intent-map?intent=${encodeURIComponent(intent.id)}`,
    })),
  )
}

export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function localHistory(): HistoryEntry[] {
  return sortHistory(loadHistory())
}
