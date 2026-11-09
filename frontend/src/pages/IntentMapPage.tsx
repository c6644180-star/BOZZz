import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Folder,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'
import { useModules } from '../hooks/useModules'
import { probeBackend } from '../services/backend'
import {
  approveIntent,
  executeIntent,
  fetchWorkspace,
  getIntent,
  listAudit,
  listIntents,
  proposeIntent,
  rejectIntent,
  type AuditEntry,
  type IntentStatus,
  type IntentSummary,
  type IntentView,
  type WorkflowStep,
  type WorkspaceSummary,
} from '../services/intent'
import type { ConnStatus } from '../types/bozz'
import { emitTaskResult } from '../services/taskSignal'

const STEP_ORDER = ['UNDERSTAND', 'PLAN', 'APPROVE', 'EXECUTE', 'VERIFY', 'REPORT'] as const

const STEP_LABELS: Record<string, string> = {
  UNDERSTAND: 'Understand',
  PLAN: 'Plan',
  APPROVE: 'Approve',
  EXECUTE: 'Execute',
  VERIFY: 'Verify',
  REPORT: 'Report',
}

const STATUS_LABELS: Record<IntentStatus, string> = {
  unrecognized: 'Not understood',
  blocked: 'Blocked',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  reported: 'Reported',
  failed: 'Failed',
}

const APPROVAL_LABELS: Record<string, string> = {
  not_requested: 'Not requested',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

const PERMISSION_LABELS: Record<string, string> = {
  file_access: 'File access folder',
  message_data: 'Message data',
  camera: 'Camera',
  microphone: 'Microphone',
  device_control: 'Device control',
  messaging: 'Messaging',
  network: 'Network',
}

const DEFAULT_EXAMPLES = [
  'list files in demo',
  'read demo/hello.txt',
  'create file demo/hello.txt with content Hello from BOZZ',
  'append second line to demo/hello.txt',
  'search for hello in demo',
  'workspace status',
]

const emptySteps: WorkflowStep[] = STEP_ORDER.map((step) => ({
  step,
  status: 'pending',
  detail: 'Not started.',
  at: null,
}))

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'The request failed.')

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export default function IntentMapPage() {
  const [backend, setBackend] = useState<ConnStatus>('checking')
  const [text, setText] = useState('')
  const [run, setRun] = useState<IntentView | null>(null)
  const [runs, setRuns] = useState<IntentSummary[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [busy, setBusy] = useState<'propose' | 'approve' | 'reject' | 'load' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedIntent = searchParams.get('intent')
  const { snapshot, offline: modulesOffline } = useModules()
  const intentModule = snapshot.modules.find((module) => module.id === 'intent-map')
  const fileAccess = intentModule?.permissions.find((item) => item.id === 'file_access')
  const fileAccessGranted = fileAccess?.granted === true
  const fileAccessKnown = !modulesOffline && intentModule !== undefined

  const refreshHistory = useCallback(async () => {
    const [intentList, auditList, workspaceInfo] = await Promise.all([
      listIntents(8),
      listAudit(12),
      fetchWorkspace().catch(() => null),
    ])
    setRuns(intentList.intents)
    setAudit(auditList.entries)
    setWorkspace(workspaceInfo)
  }, [])

  useEffect(() => {
    let alive = true
    void probeBackend().then(async (status) => {
      if (!alive) return
      setBackend(status)
      if (status !== 'online') return
      try {
        await refreshHistory()
      } catch (caught) {
        if (alive) setError(messageOf(caught))
      }
    })
    return () => {
      alive = false
    }
  }, [refreshHistory])

  useEffect(() => {
    if (!requestedIntent) return
    let alive = true
    void (async () => {
      try {
        const intent = await getIntent(requestedIntent)
        if (alive) setRun(intent)
      } catch (caught) {
        if (alive) setError(messageOf(caught))
      } finally {
        if (alive) setSearchParams({}, { replace: true })
      }
    })()
    return () => {
      alive = false
    }
  }, [requestedIntent, setSearchParams])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const command = text.trim()
    if (!command || busy) return
    setBusy('propose')
    setError(null)
    try {
      const next = await proposeIntent(command)
      setRun(next)
      await refreshHistory()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(null)
    }
  }

  async function approveAndExecute() {
    if (!run || !run.approval_id || busy) return
    setBusy('approve')
    setError(null)
    try {
      const approved = await approveIntent(run.id, run.approval_id)
      setRun(approved)
      const finished = await executeIntent(run.id)
      setRun(finished)
      emitTaskResult({ ok: finished.status === 'reported' })
      await refreshHistory()
    } catch (caught) {
      emitTaskResult({ ok: false })
      setError(messageOf(caught))
    } finally {
      setBusy(null)
    }
  }

  async function rejectPlan() {
    if (!run || busy) return
    setBusy('reject')
    setError(null)
    try {
      const rejected = await rejectIntent(run.id, 'Rejected from the Intent Map.')
      setRun(rejected)
      await refreshHistory()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(null)
    }
  }

  async function openRun(id: string) {
    if (busy) return
    setBusy('load')
    setError(null)
    try {
      setRun(await getIntent(id))
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(null)
    }
  }

  const steps = run?.steps ?? emptySteps
  const examples = run?.examples?.length ? run.examples : DEFAULT_EXAMPLES

  return (
    <ModulePage
      title="Intent Map"
      subtitle="A real local action workflow: UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT. Actions run only inside the BOZZ workspace, are risk-rated, and require explicit approval."
      tone={backend === 'offline' ? 'preview' : 'live'}
    >
      {backend === 'offline' && (
        <div className="workflow-banner" role="status">
          <AlertTriangle />
          <span>
            The local backend is offline. Start FastAPI to plan and run workflow actions. Read-only browser
            modules still work.
          </span>
        </div>
      )}

      {backend === 'online' && fileAccessKnown && !fileAccessGranted && (
        <div className="workflow-banner permission-off" role="status">
          <ShieldOff />
          <span>
            File access folder is <strong>off</strong> for Intent Map. The backend blocks planning, workspace reads
            and execution until you grant it.{' '}
            <Link to="/settings#module-permissions">Grant file access in Settings</Link>.
          </span>
        </div>
      )}

      <div className="workflow-grid">
        <section className="workflow-panel">
          <div className="workflow-panel-head">
            <h2>Command</h2>
            <span className="workspace-chip">
              <Folder />
              {workspace ? `${workspace.path_hint} · ${workspace.stats.files} file(s)` : 'workspace'}
            </span>
          </div>
          <form onSubmit={submit} className="workflow-form">
            <label htmlFor="workflow-command">Describe an action in plain text</label>
            <textarea
              id="workflow-command"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="e.g. create file demo/hello.txt with content Hello from BOZZ"
            />
            <div className="workflow-examples">
              {examples.map((example) => (
                <button key={example} type="button" onClick={() => setText(example)}>
                  {example}
                </button>
              ))}
            </div>
            <button className="primary-action" type="submit" disabled={busy !== null || !text.trim() || backend === 'offline' || (fileAccessKnown && !fileAccessGranted)}>
              <Play />
              {busy === 'propose' ? 'Planning…' : 'Plan command'}
            </button>
          </form>
          {error && <p className="workflow-error" role="alert">{error}</p>}
          <p className="workflow-note">
            No model invents actions here. Unsupported text is reported as not understood, and nothing runs
            before approval.
          </p>
        </section>

        <section className="workflow-panel">
          <div className="workflow-panel-head">
            <h2>Workflow</h2>
            {run && <span className={`status-chip status-${run.status}`}>{STATUS_LABELS[run.status]}</span>}
          </div>
          <ol className="stage-list">
            {steps.map((step, index) => (
              <li key={step.step} className={`stage stage-${step.status}`}>
                <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{STEP_LABELS[step.step] ?? step.step}</strong>
                  <small>{step.detail}</small>
                </div>
                <span className="stage-state">{step.status}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {run && (
        <section className="workflow-panel plan-panel" aria-live="polite">
          <div className="workflow-panel-head">
            <h2>Plan review</h2>
            <span className="plan-command">{run.text}</span>
          </div>
          <p className={`plan-message status-${run.status}`}>{run.message}</p>

          <div className="task-meta" aria-label="Intent task state">
            <span>Module: <strong>{run.module}</strong></span>
            <span>Approval: <strong>{APPROVAL_LABELS[run.approval_state] ?? run.approval_state}</strong></span>
            <span>
              Permissions:{' '}
              <strong>
                {run.required_permissions.length === 0
                  ? 'none'
                  : run.required_permissions.map((item) => PERMISSION_LABELS[item] ?? item).join(', ')}
              </strong>
            </span>
            <span className={run.done_allowed ? 'task-done allowed' : 'task-done'}>
              {run.done_allowed ? <CheckCircle2 /> : <ShieldOff />}
              {run.done_allowed ? 'Verified and reported done' : 'Not marked done'}
            </span>
          </div>

          {run.errors.length > 0 && (
            <ul className="task-errors" aria-label="Task errors">
              {run.errors.map((item) => (
                <li key={`${item.stage}-${item.detail}`}>
                  <AlertTriangle />
                  <span><strong>{item.stage}:</strong> {item.detail}</span>
                </li>
              ))}
            </ul>
          )}

          {run.verification_evidence.length > 0 && (
            <ul className="task-evidence" aria-label="Verification evidence">
              {run.verification_evidence.map((item, index) => (
                <li key={`${item.action}-${index}`} className={item.ok ? 'ok' : 'bad'}>
                  {item.ok ? <CheckCircle2 /> : <AlertTriangle />}
                  <span>
                    <strong>{item.source ?? 'check'}:</strong> {item.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!run.done_allowed && run.status === 'reported' && (
            <p className="workflow-error" role="alert">
              The backend reported this task without verification evidence, so BOZZ does not mark it done.
            </p>
          )}

          {run.warnings.length > 0 && (
            <ul className="plan-warnings">
              {run.warnings.map((warning) => (
                <li key={warning}><AlertTriangle />{warning}</li>
              ))}
            </ul>
          )}

          {run.actions.length > 0 && (
            <div className="plan-actions">
              {run.actions.map((action, index) => (
                <article key={`${action.type}-${index}`} className="plan-action">
                  <header>
                    <FileText />
                    <strong>{action.type.replace('workspace.', '')}</strong>
                    <span className={`risk-chip risk-${action.risk}`}>{action.risk} risk</span>
                    <span className={action.reversible ? 'reverse-chip on' : 'reverse-chip'}>
                      {action.reversible ? 'recoverable' : 'not reversible'}
                    </span>
                  </header>
                  <p className="plan-target">{action.target}</p>
                  <p className="plan-description">{action.description}</p>
                  {action.preview && action.preview !== action.target && (
                    <pre className="plan-preview">{action.preview}</pre>
                  )}
                </article>
              ))}
            </div>
          )}

          {run.status === 'awaiting_approval' && (
            <div className="workflow-actions">
              <button className="primary-action" onClick={approveAndExecute} disabled={busy !== null || !run.approval_id}>
                <ShieldCheck />
                {busy === 'approve' ? 'Executing…' : 'Approve & execute'}
              </button>
              <button className="secondary-action" onClick={rejectPlan} disabled={busy !== null}>
                <X />
                Reject plan
              </button>
              <span className="approval-hint">
                Approval is bound to this plan. Any change requires a new plan and a new approval.
              </span>
            </div>
          )}

          {run.status === 'approved' && (
            <div className="workflow-actions">
              <button
                className="primary-action"
                onClick={() => void executeIntent(run.id).then(setRun).catch((caught: unknown) => setError(messageOf(caught)))}
                disabled={busy !== null}
              >
                <Play />
                Execute approved plan
              </button>
            </div>
          )}

          {run.report && (
            <div className="report-block">
              <h3>{run.report.summary}</h3>
              <ul className="report-actions">
                {run.report.actions.map((action) => (
                  <li key={`${action.index}-${action.type}`} className={action.ok ? 'ok' : 'bad'}>
                    {action.ok ? <CheckCircle2 /> : <AlertTriangle />}
                    <span>{action.detail}</span>
                  </li>
                ))}
              </ul>
              {run.report.verification.length > 0 && (
                <ul className="report-verification">
                  {run.report.verification.map((check) => (
                    <li key={check.action} className={check.ok ? 'ok' : 'bad'}>
                      {check.ok ? <CheckCircle2 /> : <AlertTriangle />}
                      <span>Check {check.action}: {check.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <small>Finished {formatTime(run.report.finished_at)}</small>
            </div>
          )}
        </section>
      )}

      <div className="workflow-grid lower">
        <section className="workflow-panel">
          <div className="workflow-panel-head">
            <h2><Clock /> Recent runs</h2>
            <button className="icon-action" onClick={() => void refreshHistory().catch((caught: unknown) => setError(messageOf(caught)))} aria-label="Refresh recent runs">
              <RefreshCw />
            </button>
          </div>
          {runs.length === 0 ? (
            <p className="workflow-note">No workflow runs yet. Plan your first command above.</p>
          ) : (
            <ul className="run-list">
              {runs.map((item) => (
                <li key={item.id}>
                  <button className={run?.id === item.id ? 'active' : ''} onClick={() => void openRun(item.id)} disabled={busy !== null}>
                    <span>{item.raw_text}</span>
                    <small>{STATUS_LABELS[item.status]} · {formatTime(item.created_at)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="workflow-panel">
          <div className="workflow-panel-head">
            <h2><ShieldCheck /> Audit trail</h2>
            {workspace && <span className="workspace-chip">{workspace.stats.folders} folder(s) · {formatBytes(workspace.stats.bytes)}</span>}
          </div>
          {audit.length === 0 ? (
            <p className="workflow-note">No audit entries yet. Every plan, approval, action, and report is appended here.</p>
          ) : (
            <ul className="audit-list">
              {audit.map((entry) => (
                <li key={entry.id}>
                  <span className={`audit-event event-${entry.outcome}`}>{entry.event}</span>
                  <div>
                    <span>{entry.detail}</span>
                    <small>{formatTime(entry.created_at)}{entry.risk ? ` · ${entry.risk} risk` : ''}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ModulePage>
  )
}
