import { addHistoryEntry, uid } from '../services/localStore'
import {
  BciApiError,
  getConversation,
  listConversations,
  runBciAction,
  type BciAction,
  type BciActionResult,
  type BciConversation,
} from '../services/bci'
import { getBciSelection, navigateToMessages, setBciSelection, setPendingBciAction } from './messagesBridge'
import type { BciActionPayload } from './types'

export interface BciCommandOutcome {
  reply: string
}

type ParsedBciCommand =
  | { kind: 'show' }
  | { kind: 'action'; action: BciAction; language?: string; instruction?: string }

const SHOW_RE =
  /^(?:show|open|go to)(?: the)? (?:bci|messages|message centre|message center)(?: workspace| page)?$/i
const SUMMARY_RE =
  /^(?:please )?(?:summari[sz]e|summary(?: of)?)(?: (?:my|the|this))?(?: (?:messages|conversation|chat))?$/i
const UNANSWERED_RE =
  /^(?:(?:show|list|check)(?: me)?(?: for)? )?(?:(?:any|which|what) )?(?:unanswered questions?|questions? (?:that are |are )?unanswered)(?: in (?:my|the) (?:messages|conversation))?\??$/i
const ATTENTION_RE =
  /^(?:(?:show|list)(?: me)? (?:the )?(?:messages|items) that need attention|(?:what|which)(?: (?:messages|parts?))? (?:needs|need) (?:my )?attention(?: in (?:my|the) (?:messages|conversation))?|needs attention)\??$/i
const DRAFT_RE = /^(?:draft|write|compose)(?: me)? (?:a |an )?(?:reply|response|draft)(?: to (.+?))?[.!?]?$/i
const TRANSLATE_RE = /^translate (?:my |the )?draft(?: to| into) ([a-z][a-z ]{1,38})[.!?]?$/i

function parseBciCommand(text: string): ParsedBciCommand | null {
  const command = text.trim().replace(/\s+/g, ' ')
  if (!command) return null
  if (SHOW_RE.test(command)) return { kind: 'show' }
  if (SUMMARY_RE.test(command)) return { kind: 'action', action: 'summarise' }
  if (UNANSWERED_RE.test(command)) return { kind: 'action', action: 'unanswered' }
  if (ATTENTION_RE.test(command)) return { kind: 'action', action: 'attention' }
  const translate = command.match(TRANSLATE_RE)
  if (translate) {
    const language = translate[1].trim().replace(/\s+please$/i, '').trim()
    if (language) return { kind: 'action', action: 'translate', language }
  }
  const draft = command.match(DRAFT_RE)
  if (draft) {
    const target = (draft[1] || '').trim().replace(/\s+please$/i, '').trim()
    return {
      kind: 'action',
      action: 'draft',
      instruction: target ? `Reply to ${target}` : undefined,
    }
  }
  return null
}

function compact(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

function errorReply(error: unknown): string {
  if (error instanceof BciApiError) {
    if (error.status === 403) {
      return 'Message access is off. Open BCI Messages, grant Message data, then ask again. Nothing was sent.'
    }
    if (error.status === 409) {
      return `The configured AI provider "${error.provider ?? 'remote provider'}" is remote and has not been confirmed. Open BCI Messages and confirm it once. Nothing was sent.`
    }
    return `${error.message} Nothing was sent.`
  }
  return 'The local Messages service is unavailable. Nothing was sent.'
}

async function resolveConversation():
  Promise<{ conversation: BciConversation } | { problem: string }> {
  const selected = getBciSelection()
  if (selected) {
    try {
      return { conversation: (await getConversation(selected)).conversation }
    } catch (error) {
      if (!(error instanceof BciApiError) || error.status !== 404) throw error
      setBciSelection(null)
    }
  }
  const list = await listConversations()
  const first = list.conversations[0]
  if (!first) {
    return {
      problem:
        'There are no stored conversations yet. Open BCI Messages and paste, import or load the Simulation sample first. Nothing was sent.',
    }
  }
  return { conversation: (await getConversation(first.id)).conversation }
}

function replyFor(
  action: BciAction,
  result: BciActionResult,
  conversation: BciConversation,
  language?: string,
): string {
  switch (action) {
    case 'summarise':
      return `Summary of "${conversation.title}" from ${result.provider}/${result.model}: ${compact(result.text, 480)} Nothing was sent.`
    case 'attention': {
      if (!result.items.length) return `No messages in "${conversation.title}" need attention. Nothing was sent.`
      const items = result.items
        .slice(0, 3)
        .map((item) => `${item.sender} (${item.reasons.join(', ')})`)
        .join('; ')
      return `${result.items.length} message(s) need attention: ${items}. Open BCI Messages for the excerpts. Nothing was sent.`
    }
    case 'unanswered': {
      if (!result.questions.length) return `Every question in "${conversation.title}" has a later reply. Nothing was sent.`
      const first = result.questions[0]
      return `${result.questions.length} question(s) are unanswered. ${first.sender} asked: "${compact(first.text, 200)}" Open BCI Messages for the rest. Nothing was sent.`
    }
    case 'draft': {
      const blockers = result.placeholders.length
        ? ` ${result.placeholders.length} [CONFIRM] placeholder(s) keep Copy blocked until you resolve them.`
        : ''
      return `A draft reply for "${conversation.title}" is ready in BCI Messages. It is labelled "Draft only, not sent".${blockers} Nothing was sent.`
    }
    case 'rewrite':
      return `The draft for "${conversation.title}" was rewritten in BCI Messages. Nothing was sent.`
    case 'translate':
      return `The translation into ${language ?? 'the requested language'} is ready in BCI Messages. Nothing was sent.`
  }
}

function recordHistory(action: BciAction, conversation: BciConversation, ok: boolean, intentId: string): void {
  const title = `BCI: ${action} ${conversation.title}`
  addHistoryEntry({
    id: uid(),
    title: title.length > 90 ? `${title.slice(0, 87)}…` : title,
    kind: 'task',
    status: ok ? 'done' : 'failed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    href: `/intent-map?intent=${encodeURIComponent(intentId)}`,
  })
}

export async function runBciCommand(text: string): Promise<BciCommandOutcome | null> {
  const parsed = parseBciCommand(text)
  if (!parsed) return null

  if (parsed.kind === 'show') {
    navigateToMessages()
    return { reply: 'Opening BCI Messages. Conversations stay in the local database and nothing can be sent.' }
  }

  let resolved: { conversation: BciConversation } | { problem: string }
  try {
    resolved = await resolveConversation()
  } catch (error) {
    return { reply: errorReply(error) }
  }
  if ('problem' in resolved) return { reply: resolved.problem }
  const conversation = resolved.conversation

  if (conversation.provider.requires_confirmation) {
    return {
      reply: `The configured provider "${conversation.provider.provider}" is remote and has not been confirmed. Open BCI Messages and confirm it once before sending conversation text to it. Nothing was sent.`,
    }
  }

  const payload: BciActionPayload = {}
  if (parsed.language) payload.language = parsed.language
  if (parsed.instruction) payload.instruction = parsed.instruction
  if (parsed.action === 'translate') {
    const draft = conversation.drafts[0]
    if (!draft) {
      return { reply: 'There is no saved draft to translate. Ask me to draft a reply first. Nothing was sent.' }
    }
    payload.draft_id = draft.id
  }

  let response
  try {
    response = await runBciAction(conversation.id, parsed.action, payload)
  } catch (error) {
    return { reply: errorReply(error) }
  }

  recordHistory(parsed.action, conversation, response.result !== null, response.id)

  if (!response.result) {
    return { reply: `${response.message} Nothing was sent.` }
  }

  setBciSelection(conversation.id)
  setPendingBciAction({
    id: response.id,
    conversationId: conversation.id,
    action: parsed.action,
    response,
    payload,
  })
  navigateToMessages()
  return { reply: replyFor(parsed.action, response.result, conversation, parsed.language) }
}
