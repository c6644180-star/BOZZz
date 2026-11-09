import type { BciAction } from '../services/bci'

export function formatWhen(value: string | null | undefined): string {
  if (!value) return 'No timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text
}

export function actionLabel(action: BciAction): string {
  return {
    summarise: 'Summary',
    unanswered: 'Unanswered questions',
    attention: 'Needs attention',
    draft: 'Draft reply',
    rewrite: 'Rewritten draft',
    translate: 'Translation',
  }[action]
}

export function reasonLabel(reason: string): string {
  return {
    question: 'Question',
    money: 'Money',
    'time-sensitive': 'Time',
    commitment: 'Commitment',
    request: 'Request',
  }[reason] ?? reason
}
