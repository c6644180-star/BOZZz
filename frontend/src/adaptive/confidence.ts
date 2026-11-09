import type {
  ActionClass,
  ActionDecision,
  Confidence,
  ConfidenceSource,
  Decision,
} from './types'

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function makeConfidence(
  value: number,
  source: ConfidenceSource,
  reasons: string[],
): Confidence {
  return { value: clamp01(value), source, reasons: reasons.filter((reason) => reason.trim().length > 0) }
}

export interface ConfidencePart {
  value: number
  weight?: number
  reason: string
}

// Weighted geometric mean: one weak ingredient cannot be hidden by a strong one.
export function combineConfidence(parts: ConfidencePart[], source: ConfidenceSource = 'measurement'): Confidence {
  const usable = parts.filter((part) => Number.isFinite(part.value))
  if (usable.length === 0) return makeConfidence(0, source, ['No usable signals were measured.'])
  let weightSum = 0
  let logSum = 0
  for (const part of usable) {
    const weight = Math.max(0.01, part.weight ?? 1)
    weightSum += weight
    logSum += Math.log(Math.max(1e-4, clamp01(part.value))) * weight
  }
  return makeConfidence(Math.exp(logSum / weightSum), source, usable.map((part) => part.reason))
}

const BLOCKED = /\b(shut ?down|restart|log ?off|delete|rename|move (a |the )?file|recycle bin|format (a |the )?(drive|disk)|install|uninstall|password|account|send (a )?(message|email)|pay|transfer money|disable (antivirus|security)|powershell|command prompt|cmd|shell|script)\b/i

const CONSEQUENTIAL = /\b(open|launch|start|run|click|double ?click|right ?click|scroll|drag|drop|type|dictation|volume|mute|unmute|brightness|screenshot|screen shot|switch window|alt tab|minimi[sz]e|maximi[sz]e|go back|go forward|zoom in|zoom out|approve|allow it|go ahead|save|export|write|create)\b/i

export function classifyAction(text: string): ActionClass {
  const command = text.trim()
  if (!command) return 'safe'
  if (BLOCKED.test(command)) return 'blocked'
  if (CONSEQUENTIAL.test(command)) return 'consequential'
  return 'safe'
}

export function fallbackFor(actionClass: ActionClass): string {
  if (actionClass === 'blocked') return 'That action is blocked for safety. Nothing was executed — do it yourself.'
  if (actionClass === 'consequential') return 'I am not sure enough to do that. Use the on-screen button instead.'
  return 'I am not sure I heard that. Say it again or use push-to-talk.'
}

export interface ThresholdConfig {
  safe: number
  consequential: number
}

export function evaluateConfidence(
  confidence: Confidence,
  actionClass: ActionClass,
  thresholds: ThresholdConfig,
): ActionDecision {
  const value = clamp01(confidence.value)
  if (actionClass === 'blocked') {
    return {
      actionClass,
      decision: 'block',
      threshold: 1,
      fallback: fallbackFor('blocked'),
      reason: 'This action class is always blocked, whatever the confidence.',
    }
  }
  if (actionClass === 'consequential') {
    if (value < thresholds.consequential) {
      return {
        actionClass,
        decision: 'reject',
        threshold: thresholds.consequential,
        fallback: fallbackFor('consequential'),
        reason: `Confidence ${percent(value)} is below the ${percent(thresholds.consequential)} required for consequential actions.`,
      }
    }
    return {
      actionClass,
      decision: 'confirm',
      threshold: thresholds.consequential,
      fallback: 'This action needs your explicit approval.',
      reason: `Confidence ${percent(value)} meets the consequential threshold; approval is still required.`,
    }
  }
  if (value < thresholds.safe) {
    return {
      actionClass,
      decision: 'reject',
      threshold: thresholds.safe,
      fallback: fallbackFor('safe'),
      reason: `Confidence ${percent(value)} is below the ${percent(thresholds.safe)} safe threshold.`,
    }
  }
  return {
    actionClass,
    decision: 'execute',
    threshold: thresholds.safe,
    fallback: 'If that was wrong, say “undo”.',
    reason: `Confidence ${percent(value)} meets the safe threshold.`,
  }
}

// A doubtful but audible command can be checked with "Did you say …?" instead
// of being dropped silently. Very low confidence is not worth a question.
export function clarifyAndDecide(
  confidence: Confidence,
  actionClass: ActionClass,
  thresholds: ThresholdConfig,
): ActionDecision | null {
  const decision = evaluateConfidence(confidence, actionClass, thresholds)
  if (decision.decision !== 'reject') return null
  if (confidence.value < 0.25) return null
  return decision
}

export function decisionLabel(decision: Decision): string {
  if (decision === 'execute') return 'Execute'
  if (decision === 'confirm') return 'Needs approval'
  if (decision === 'reject') return 'Not sure — skipped'
  return 'Blocked'
}

export function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`
}

export function clarificationPrompt(command: string): string {
  return `Did you say “${command.trim()}”? Say yes, or no.`
}

export function isYes(text: string): boolean {
  return /^(?:bozz[,\s]+)?(?:yes|yeah|yep|correct|confirm|do it|approve)$/i.test(text.trim())
}

export function isNo(text: string): boolean {
  return /^(?:bozz[,\s]+)?(?:no|nope|cancel|stop|don't|do not|deny|never mind)$/i.test(text.trim())
}

export function isUndoPhrase(text: string): boolean {
  return /^(?:bozz[,\s]+)?undo(?: (?:that|the last action|last action))?$/i.test(text.trim())
}

export function parseLabelPhrase(text: string): string | null {
  const match = /^(?:bozz[,\s]+)?(?:this is|call this|name this|label this)(?: the)?\s+(.+?)[.!?]*$/i.exec(text.trim())
  return match ? match[1].trim() : null
}
