import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  BrainCircuit,
  CircleAlert,
  FileText,
  FlaskConical,
  Loader2,
  MessageSquarePlus,
  PenLine,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useModules } from '../hooks/useModules'
import {
  BciApiError,
  SAMPLE_CONVERSATION,
  confirmBciProvider,
  createConversation,
  deleteAllConversations,
  deleteConversation,
  deleteDraft,
  fetchBciProvider,
  fetchBciSettings,
  getConversation,
  listConversations,
  runBciAction,
  sourceLabel,
  updateConversation,
  updateDraft,
  type BciAction,
  type BciConversation,
  type BciConversationSummary,
  type BciProviderInfo,
  type BciSettings,
} from '../services/bci'
import { pushToast } from '../services/toast'
import { ActionResultCard } from '../messages/ActionResultCard'
import { ConversationSidebar } from '../messages/ConversationSidebar'
import { ConfirmDialog } from '../messages/Dialogs'
import { DraftCard } from '../messages/DraftCard'
import { ImportDialog } from '../messages/ImportDialog'
import { MessageThread } from '../messages/MessageThread'
import { actionLabel, formatCount, formatWhen } from '../messages/format'
import {
  consumePendingBciAction,
  getBciSelection,
  setBciSelection,
  subscribeBciBridge,
} from '../messages/messagesBridge'
import type { ActionEnvelope, BciActionPayload } from '../messages/types'

type ConfirmState =
  | { kind: 'conversation'; id: string; title: string }
  | { kind: 'draft'; id: string; title: string }
  | { kind: 'all' }
  | { kind: 'provider' }
  | null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The local Messages request failed.'
}

function retentionLabel(days: number): string {
  return days === 0 ? 'Keep until deleted' : `Keep ${days} days`
}

export default function MessagesPage() {
  const { snapshot, loading: modulesLoading, setPermission, busy: permissionBusy, error: modulesError } = useModules()
  const module = snapshot.modules.find((item) => item.id === 'bci')
  const granted = module?.permissions.find((item) => item.id === 'message_data')?.granted === true

  const [provider, setProvider] = useState<BciProviderInfo | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [settings, setSettings] = useState<BciSettings | null>(null)
  const [conversations, setConversations] = useState<BciConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() => getBciSelection())
  const [conversation, setConversation] = useState<BciConversation | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [envelopes, setEnvelopes] = useState<ActionEnvelope[]>([])
  const [busyAction, setBusyAction] = useState<BciAction | null>(null)
  const [busyDraft, setBusyDraft] = useState<string | null>(null)
  const [draftInstruction, setDraftInstruction] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<'file' | 'paste'>('file')
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)

  const refresh = useCallback(() => setRefreshTick((value) => value + 1), [])

  useEffect(() => {
    let alive = true
    void fetchBciProvider().then(
      (info) => {
        if (!alive) return
        setProvider(info)
        setProviderError(null)
      },
      (error: unknown) => {
        if (alive) setProviderError(errorText(error))
      },
    )
    return () => {
      alive = false
    }
  }, [refreshTick])

  useEffect(() => {
    if (!granted) return
    let alive = true
    void fetchBciSettings().then(
      (value) => {
        if (alive) setSettings(value)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [granted])

  useEffect(() => {
    if (!granted) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setListLoading(true)
      void listConversations({
        q: query.trim() || undefined,
        source: source || undefined,
        attention: attentionOnly,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return
          setConversations(result.conversations)
          setListError(null)
          setSelectedId((current) => {
            if (current && result.conversations.some((item) => item.id === current)) return current
            return result.conversations[0]?.id ?? null
          })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          if (error instanceof DOMException && error.name === 'AbortError') return
          setListError(errorText(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setListLoading(false)
        })
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [granted, query, source, attentionOnly, refreshTick])

  useEffect(() => {
    setBciSelection(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!granted || !selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConversation(null)
      return
    }
    const controller = new AbortController()
    // The conversation is fetched from the local API; the result arrives asynchronously.
    setDetailLoading(true)
    setDetailError(null)
    void getConversation(selectedId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setConversation(result.conversation)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (error instanceof BciApiError && error.status === 404) {
          setDetailError('This conversation no longer exists. It may have been removed by retention cleanup.')
          setSelectedId(null)
          refresh()
          return
        }
        setDetailError(errorText(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => controller.abort()
  }, [granted, selectedId, refreshTick, refresh])

  useEffect(() => {
    const consume = () => {
      const pending = consumePendingBciAction()
      if (!pending) return
      setEnvelopes((prev) => [pending, ...prev.filter((item) => item.id !== pending.id)].slice(0, 6))
      setSelectedId(pending.conversationId)
      refresh()
    }
    consume()
    return subscribeBciBridge(consume)
  }, [refresh])

  const loadConversation = useCallback(async (id: string) => {
    const result = await getConversation(id)
    setConversation(result.conversation)
    setDetailError(null)
  }, [])

  const runAction = useCallback(
    async (action: BciAction, payload: BciActionPayload = {}) => {
      if (!conversation) return
      setBusyAction(action)
      try {
        const response = await runBciAction(conversation.id, action, payload)
        const envelope: ActionEnvelope = {
          id: response.id,
          conversationId: conversation.id,
          action,
          response,
          payload,
        }
        setEnvelopes((prev) => [envelope, ...prev.filter((item) => item.id !== envelope.id)].slice(0, 6))
        if (response.result) {
          pushToast(
            'success',
            `${actionLabel(action)} ready`,
            `Generated by ${response.result.provider}/${response.result.model} from local text. Nothing was sent.`,
          )
        } else {
          pushToast('error', `${actionLabel(action)} failed`, response.message)
        }
        await loadConversation(conversation.id).catch(() => undefined)
        refresh()
      } catch (error) {
        if (error instanceof BciApiError && error.status === 409) {
          setConfirm({ kind: 'provider' })
          pushToast('warning', 'Provider confirmation required', error.message)
        } else {
          pushToast('error', `${actionLabel(action)} failed`, errorText(error))
        }
      } finally {
        setBusyAction(null)
      }
    },
    [conversation, loadConversation, refresh],
  )

  async function grant() {
    const ok = await setPermission('bci', 'message_data', true)
    if (ok) {
      pushToast('success', 'Message access granted', 'BCI can read conversations in the local database. Nothing is sent.')
      refresh()
    }
  }

  async function loadSample() {
    setSampleBusy(true)
    try {
      const result = await createConversation(SAMPLE_CONVERSATION)
      pushToast('success', 'Simulation stored locally', 'Clearly labelled sample text, not a real chat. Nothing was sent.')
      setSelectedId(result.conversation.id)
      refresh()
    } catch (error) {
      pushToast('error', 'Could not store the simulation', errorText(error))
    } finally {
      setSampleBusy(false)
    }
  }

  async function saveDraft(id: string, text: string) {
    setBusyDraft(id)
    try {
      await updateDraft(id, { text })
      if (conversation) await loadConversation(conversation.id)
      pushToast('success', 'Draft saved locally', 'It is still labelled "Draft only, not sent".')
      refresh()
    } catch (error) {
      pushToast('error', 'Could not save the draft', errorText(error))
    } finally {
      setBusyDraft(null)
    }
  }

  async function removeDraft(id: string) {
    const draft = conversation?.drafts.find((item) => item.id === id)
    setConfirm({ kind: 'draft', id, title: draft?.text.slice(0, 60) ?? 'Draft' })
  }

  async function changeRetention(days: number) {
    if (!conversation) return
    try {
      const result = await updateConversation(conversation.id, { retention_days: days })
      setConversation(result.conversation)
      pushToast('info', 'Retention updated', `${retentionLabel(days)} for this conversation.`)
      refresh()
    } catch (error) {
      pushToast('error', 'Could not change retention', errorText(error))
    }
  }

  async function runConfirm() {
    if (!confirm) return
    setConfirmBusy(true)
    try {
      if (confirm.kind === 'conversation') {
        await deleteConversation(confirm.id)
        if (selectedId === confirm.id) setSelectedId(null)
        pushToast('success', 'Conversation deleted', 'Removed from the local database. Nothing was sent.')
        refresh()
      } else if (confirm.kind === 'all') {
        const result = await deleteAllConversations()
        setSelectedId(null)
        setConversation(null)
        setEnvelopes([])
        pushToast('success', 'All conversations deleted', `${result.count} conversation(s) removed locally. Nothing was sent.`)
        refresh()
      } else if (confirm.kind === 'draft') {
        await deleteDraft(confirm.id)
        if (conversation) await loadConversation(conversation.id)
        pushToast('success', 'Draft deleted', 'Removed locally. Nothing was sent.')
        refresh()
      } else if (confirm.kind === 'provider' && provider) {
        const next = await confirmBciProvider(provider.provider)
        setProvider(next)
        pushToast(
          'success',
          'Provider confirmed',
          `${next.provider}/${next.model} may now receive conversation text for AI actions you start.`,
        )
      }
      setConfirm(null)
    } catch (error) {
      pushToast('error', 'The action failed', errorText(error))
    } finally {
      setConfirmBusy(false)
    }
  }

  const visibleEnvelopes = useMemo(
    () => envelopes.filter((item) => item.conversationId === conversation?.id),
    [envelopes, conversation?.id],
  )

  const confirmCopy = useMemo(() => {
    if (!confirm) return null
    if (confirm.kind === 'provider') {
      return {
        title: 'Use this remote AI provider?',
        label: 'Confirm provider',
        danger: false,
      }
    }
    if (confirm.kind === 'all') {
      return {
        title: 'Delete all conversations?',
        label: `Delete ${conversations.length} conversation(s)`,
        danger: true,
      }
    }
    if (confirm.kind === 'draft') {
      return { title: 'Delete this draft?', label: 'Delete draft', danger: true }
    }
    return { title: 'Delete this conversation?', label: 'Delete conversation', danger: true }
  }, [confirm, conversations.length])

  const retentionOptions = settings?.options ?? [0, 7, 30, 90]

  return (
    <div className="bci-page">
      <header className="bci-toolbar">
        <div className="bci-brand">
          <BrainCircuit aria-hidden="true" />
          <div>
            <h1>BCI Messages</h1>
            <p>Local communication intelligence · there is no send path</p>
          </div>
        </div>
        <div className="bci-chips">
          <span className={`workspace-chip ${granted ? 'is-ok' : 'is-off'}`}>
            {granted ? <ShieldCheck /> : <ShieldOff />} Message data {granted ? 'on' : 'off'}
          </span>
          {module && <span className="workspace-chip">{module.status}</span>}
          {provider && (
            <span className="workspace-chip" title={provider.detail ?? undefined}>
              AI: {provider.provider}/{provider.model}
            </span>
          )}
          {provider && (
            <span className={`workspace-chip ${provider.local ? 'is-ok' : 'is-warn'}`}>
              {provider.local ? 'Local provider' : 'Remote provider'}
            </span>
          )}
        </div>
        <div className="bci-toolbar-actions">
          <button type="button" className="ghost-action" onClick={() => { setImportMode('file'); setImportOpen(true) }} disabled={!granted}>
            <Upload /> Import
          </button>
          <button type="button" className="primary-action" onClick={() => { setImportMode('paste'); setImportOpen(true) }} disabled={!granted}>
            <MessageSquarePlus /> Paste conversation
          </button>
        </div>
      </header>

      {providerError && (
        <p className="bci-banner is-error" role="alert">
          <CircleAlert /> The AI provider status could not be read: {providerError}
        </p>
      )}

      {provider && !provider.available && (
        <p className="bci-banner is-warn" role="status">
          <CircleAlert /> AI provider unavailable: {provider.detail ?? 'no provider responded'}. Local storage still
          works; AI actions will create a failed Intent Map task with the real error. Nothing is sent.
        </p>
      )}

      {provider && provider.requires_confirmation && granted && (
        <section className="bci-provider-card" aria-label="AI provider confirmation">
          <div>
            <h2><CircleAlert /> This AI provider is remote</h2>
            <p>
              AI actions would send this conversation's text to <strong>{provider.provider}/{provider.model}</strong> for
              that single request. Nothing is sent in the background, and no messaging app is contacted.
            </p>
          </div>
          <button
            type="button"
            className="primary-action"
            onClick={() => setConfirm({ kind: 'provider' })}
            disabled={confirmBusy}
          >
            <ShieldCheck /> Review and confirm
          </button>
        </section>
      )}

      {modulesLoading ? (
        <p className="bci-loading" role="status"><Loader2 /> Checking the module registry…</p>
      ) : !granted ? (
        <section className="bci-gate" aria-label="Message access required">
          <ShieldOff aria-hidden="true" />
          <h2>Message data is off</h2>
          <p>
            BCI can summarise conversations, find unanswered questions and draft replies that never leave BOZZ. The
            backend rejects every Messages request until you grant Message data. There is no send endpoint, no SMTP and
            no messaging API.
          </p>
          {provider && (
            <p className="bci-gate-provider">
              AI provider: <strong>{provider.provider}/{provider.model}</strong>{' '}
              ({provider.local ? 'runs locally' : 'remote — asks for confirmation before use'}) ·{' '}
              {provider.available ? 'available' : 'unavailable'}. Short excerpts may be sent to it for AI actions you
              start.
            </p>
          )}
          <button type="button" className="primary-action" onClick={() => void grant()} disabled={permissionBusy !== null}>
            {permissionBusy ? <Loader2 /> : <ShieldCheck />} Grant message data access
          </button>
          <Link to="/settings#message-settings" className="ghost-action">Open Messages settings</Link>
          {modulesError && <p className="bci-gate-error" role="alert"><CircleAlert /> {modulesError}</p>}
        </section>
      ) : (
        <div className="bci-layout">
          <ConversationSidebar
            conversations={conversations}
            loading={listLoading}
            error={listError}
            selectedId={selectedId}
            query={query}
            source={source}
            attentionOnly={attentionOnly}
            onQuery={setQuery}
            onSource={setSource}
            onAttention={setAttentionOnly}
            onSelect={setSelectedId}
            onDelete={(id, title) => setConfirm({ kind: 'conversation', id, title })}
            onDeleteAll={() => setConfirm({ kind: 'all' })}
            onPaste={() => { setImportMode('paste'); setImportOpen(true) }}
            onImport={() => { setImportMode('file'); setImportOpen(true) }}
            onSample={() => void loadSample()}
            onRefresh={refresh}
          />

          <section className="bci-workspace" aria-label="Selected conversation">
            {!selectedId ? (
              <div className="bci-workspace-empty">
                <FileText aria-hidden="true" />
                <h2>No conversation selected</h2>
                <p>
                  Paste a conversation, import a chat export or load the Simulation sample. BOZZ stores it in the local
                  SQLite database and never sends a message.
                </p>
                <div className="bci-empty-actions">
                  <button type="button" className="primary-action" onClick={() => { setImportMode('paste'); setImportOpen(true) }}>
                    <MessageSquarePlus /> Paste conversation
                  </button>
                  <button type="button" className="ghost-action" onClick={() => void loadSample()} disabled={sampleBusy}>
                    {sampleBusy ? <Loader2 /> : <FlaskConical />} Load Simulation sample
                  </button>
                </div>
              </div>
            ) : detailLoading && !conversation ? (
              <p className="bci-loading" role="status"><Loader2 /> Loading the conversation from SQLite…</p>
            ) : detailError ? (
              <div className="bci-workspace-error" role="alert">
                <CircleAlert aria-hidden="true" />
                <p>{detailError}</p>
                <button type="button" className="ghost-action" onClick={refresh}>
                  <RefreshCw /> Try again
                </button>
              </div>
            ) : conversation ? (
              <>
                <header className="bci-workspace-head">
                  <div className="bci-workspace-title">
                    <h2>{conversation.title}</h2>
                    <p>
                      <span className={`bci-source-chip is-${conversation.source}`}>{sourceLabel(conversation.source)}</span>
                      <span>{formatCount(conversation.messages_count)} message{conversation.messages_count === 1 ? '' : 's'}</span>
                      <span>{formatCount(conversation.char_count)} characters</span>
                      <span>updated {formatWhen(conversation.updated_at)}</span>
                    </p>
                  </div>
                  <div className="bci-workspace-actions">
                    <label className="bci-retention">
                      <span>Retention</span>
                      <select
                        value={conversation.retention_days}
                        onChange={(event) => void changeRetention(Number(event.target.value))}
                        aria-label="Conversation retention"
                      >
                        {retentionOptions.map((days) => (
                          <option key={days} value={days}>{retentionLabel(days)}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ghost-action is-danger"
                      onClick={() => setConfirm({ kind: 'conversation', id: conversation.id, title: conversation.title })}
                    >
                      <Trash2 /> Delete
                    </button>
                  </div>
                </header>

                {conversation.source === 'simulation' && (
                  <p className="bci-banner is-sim" role="note">
                    <FlaskConical /> Simulation: this is sample text bundled with BOZZ, not a real conversation.
                  </p>
                )}

                <div className="bci-actionbar" role="toolbar" aria-label="AI actions">
                  <button type="button" className="secondary-action" onClick={() => void runAction('summarise')} disabled={busyAction !== null}>
                    {busyAction === 'summarise' ? <Loader2 /> : <Sparkles />} Summarise
                  </button>
                  <button type="button" className="ghost-action" onClick={() => void runAction('unanswered')} disabled={busyAction !== null}>
                    {busyAction === 'unanswered' ? <Loader2 /> : <CircleAlert />} Unanswered
                  </button>
                  <button type="button" className="ghost-action" onClick={() => void runAction('attention')} disabled={busyAction !== null}>
                    {busyAction === 'attention' ? <Loader2 /> : <ShieldCheck />} Needs attention
                  </button>
                  <form
                    className="bci-draft-form"
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault()
                      const instruction = draftInstruction.trim()
                      void runAction('draft', instruction ? { instruction } : {})
                    }}
                  >
                    <input
                      type="text"
                      value={draftInstruction}
                      onChange={(event) => setDraftInstruction(event.target.value)}
                      maxLength={1000}
                      placeholder="Optional instruction, e.g. reply to Priya about the quote"
                      aria-label="Optional draft instruction"
                    />
                    <button type="submit" className="primary-action" disabled={busyAction !== null}>
                      {busyAction === 'draft' ? <Loader2 /> : <PenLine />} Draft reply
                    </button>
                  </form>
                </div>
                <p className="bci-action-note">
                  <ShieldOff /> An AI action sends this conversation's text to{' '}
                  {provider ? `${provider.provider}/${provider.model}` : 'the configured provider'} only when you start it.
                  Nothing is sent to WhatsApp, Telegram, Instagram or any messaging app.
                </p>

                <MessageThread messages={conversation.messages} />

                {visibleEnvelopes.length > 0 && (
                  <section className="bci-results" aria-label="AI results">
                    <div className="bci-section-head">
                      <h3>Results</h3>
                      <button type="button" className="ghost-action" onClick={() => setEnvelopes([])}>Clear results</button>
                    </div>
                    {visibleEnvelopes.map((envelope) => (
                      <ActionResultCard
                        key={envelope.id}
                        envelope={envelope}
                        busy={busyAction !== null}
                        onRegenerate={(item) => void runAction(item.action, item.payload ?? {})}
                      />
                    ))}
                  </section>
                )}

                <section className="bci-drafts" aria-label="Drafts">
                  <div className="bci-section-head">
                    <h3>Drafts</h3>
                    <span className="workspace-chip"><ShieldOff /> Draft only, not sent</span>
                  </div>
                  {conversation.drafts.length ? (
                    conversation.drafts.map((draft) => (
                      <DraftCard
                        key={`${draft.id}-${draft.updated_at}`}
                        draft={draft}
                        busy={busyDraft === draft.id || busyAction !== null}
                        onSave={saveDraft}
                        onDelete={removeDraft}
                        onRewrite={(id: string) => runAction('rewrite', { draft_id: id })}
                        onTranslate={(id: string, language: string) => runAction('translate', { draft_id: id, language })}
                      />
                    ))
                  ) : (
                    <p className="bci-empty-note">
                      No drafts yet. Draft replies stay here with a “Draft only, not sent” label and a Copy button.
                    </p>
                  )}
                </section>
              </>
            ) : null}
          </section>
        </div>
      )}

      <ImportDialog
        key={importMode}
        open={importOpen}
        initialMode={importMode}
        onClose={() => setImportOpen(false)}
        onImported={(imported: BciConversation) => {
          setSelectedId(imported.id)
          refresh()
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirmCopy?.title ?? ''}
        confirmLabel={confirmCopy?.label ?? 'Confirm'}
        busy={confirmBusy}
        danger={confirmCopy?.danger}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === 'conversation' && (
          <>
            <p>Delete <strong>{confirm.title}</strong> from the local SQLite database?</p>
            <p>The conversation, its messages and its drafts are removed. Nothing is sent, recalled or changed anywhere else. This cannot be undone.</p>
          </>
        )}
        {confirm?.kind === 'all' && (
          <>
            <p>Delete all {formatCount(conversations.length)} conversations from the local SQLite database?</p>
            <p>Their messages and drafts are removed. Nothing is sent, recalled or changed anywhere else. This cannot be undone.</p>
          </>
        )}
        {confirm?.kind === 'draft' && (
          <>
            <p>Delete this draft?</p>
            <p>“{confirm.title}…” will be removed from local storage. No message is sent.</p>
          </>
        )}
        {confirm?.kind === 'provider' && provider && (
          <>
            <p>
              AI actions will send the selected conversation's text to <strong>{provider.provider}/{provider.model}</strong>{' '}
              for that request only. Nothing is sent in the background.
            </p>
            <p>No messaging app, account or contact is contacted. This confirmation is stored locally for this provider.</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  )
}
