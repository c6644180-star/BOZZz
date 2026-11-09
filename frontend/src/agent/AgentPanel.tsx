import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  ClipboardList,
  Globe,
  History,
  OctagonAlert,
  Pause,
  Play,
  Power,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'
import { useAgent } from './AgentProvider'
import { AgentPlanView } from './AgentPlanView'
import {
  DEMO_TASK,
  RESULT_LEVEL_LABELS,
  STEP_STATUS_LABELS,
  approvalModeLabel,
  currentStep,
  formatElapsed,
  isActiveTask,
  isTerminalState,
  planTierCounts,
  reportTone,
  resultLevelLabel,
  stateLabel,
  stepTarget,
  taskProgress,
  tierLabel,
} from './state'
import type { AgentResultLevel, AgentStep, AgentTask } from './types'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function busyLabel(value: string | null): string {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function LevelChip({ level }: { level: AgentResultLevel }) {
  return (
    <span className={`agent-level is-${level}`} title={RESULT_LEVEL_LABELS[level]}>
      {RESULT_LEVEL_LABELS[level]}
    </span>
  )
}

function PendingApprovalCard({
  task,
  busy,
  onResolve,
}: {
  task: AgentTask
  busy: boolean
  onResolve: (approve: boolean) => void
}) {
  const approval = task.pending_approval
  const deadline = useMemo(() => {
    if (!approval) return 0
    const parsed = Date.parse(approval.expires_at)
    return Number.isFinite(parsed) ? parsed : Date.now() + approval.expires_in_ms
  }, [approval?.approval_id, approval?.expires_at, approval?.expires_in_ms])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  if (!approval) return null
  const remaining = Math.max(0, deadline - now)
  const expired = remaining <= 0
  return (
    <section className={`agent-approval ${expired ? 'is-expired' : ''}`} aria-label="Step approval">
      <div className="agent-approval__head">
        <ShieldAlert />
        <strong>{approval.kind === 'domain' ? 'New domain approval' : 'Tier 2 step approval'}</strong>
        <span className={`agent-tier-badge is-tier-${Math.min(approval.tier, 3)}`}>{tierLabel(approval.tier)}</span>
        <span className="agent-approval__timer">{expired ? 'Expired' : `${Math.ceil(remaining / 1000)} s left`}</span>
      </div>
      <p className="agent-approval__label">{approval.label}</p>
      <p className="agent-note">{approval.detail}</p>
      <div className="agent-actions">
        <button type="button" className="primary-action" onClick={() => onResolve(true)} disabled={busy || expired}>
          <ShieldCheck /> Approve step
        </button>
        <button type="button" className="secondary-action" onClick={() => onResolve(false)} disabled={busy}>
          <X /> Deny
        </button>
      </div>
      <p className="agent-note">
        An approval expires after the configured timeout and cancels that step. You can also say “approve” or “deny”.
      </p>
    </section>
  )
}

function StepRow({ step, task }: { step: AgentStep; task: AgentTask }) {
  const target = stepTarget(step, task)
  return (
    <li className={`agent-step is-${step.status}`}>
      <div className="agent-step__top">
        <span className="agent-step__status">{STEP_STATUS_LABELS[step.status]}</span>
        <strong>{step.goal}</strong>
        <span className={`agent-tier-badge is-tier-${Math.min(step.tier, 3)}`}>{tierLabel(step.tier)}</span>
        <LevelChip level={step.level} />
      </div>
      <p className="agent-step__target">
        {step.application} · <code>{step.action_id}</code>
        {target ? ` · ${target}` : ''}
        {step.method ? ` · ${step.method}` : ''}
      </p>
      {step.detail && <p className="agent-step__detail">{step.detail}</p>}
      {step.verification && (
        <p className={`agent-step__verify ${step.verification.ok ? 'is-ok' : 'is-bad'}`}>
          {step.verification.ok ? <CheckCircle2 /> : <AlertTriangle />}
          {step.verification.ok ? 'Verified' : 'Not verified'} · {step.verification.source}: {step.verification.detail}
        </p>
      )}
      {step.injection_warning && (
        <p className="agent-step__inject">
          <ShieldAlert /> This page tried to instruct the agent. Ignored.
        </p>
      )}
    </li>
  )
}

export function AgentPanel() {
  const {
    status,
    task,
    tasks,
    error,
    busy,
    watch,
    refresh,
    openPanel,
    setEnabled,
    resetEmergency,
    startTask,
    selectTask,
    approvePlan,
    rejectPlan,
    approveStep,
    pause,
    resume,
    cancel,
    emergencyStop,
  } = useAgent()

  const [text, setText] = useState('')
  const [dryRun, setDryRun] = useState<boolean | null>(null)
  const [allowScreenshots, setAllowScreenshots] = useState(false)
  const [screenshotProvider, setScreenshotProvider] = useState('')
  const [confirmEnable, setConfirmEnable] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    watch(true)
    return () => watch(false)
  }, [watch])

  const settings = status?.settings
  const effectiveDryRun = dryRun ?? settings?.dry_run ?? true
  const active = isActiveTask(task)
  const progress = task ? taskProgress(task) : 0
  const step = task ? currentStep(task) : null
  const canStart = Boolean(status?.enabled) && !active && text.trim().length > 0 && busy === null
  const canShareScreenshots = status?.screenshot_policy.master_switch === true

  async function start() {
    const created = await startTask(text, {
      dryRun: effectiveDryRun,
      allowScreenshots: allowScreenshots && canShareScreenshots,
      screenshotProvider: allowScreenshots && canShareScreenshots ? screenshotProvider.trim() : null,
    })
    if (created) setText(created.task)
  }

  function editPlan() {
    if (!task) return
    setText(task.task)
    void rejectPlan('The user chose to edit the task before approving it.')
  }

  return (
    <div className="agent-panel">
      <div className="agent-panel__top">
        <div
          className={`agent-state is-${status?.emergency_stopped ? 'stopped' : status?.enabled ? 'on' : 'off'}`}
          role="status"
        >
          <Bot />
          {status?.emergency_stopped ? 'Emergency stopped' : status?.enabled ? 'Agent on' : 'Agent off'}
        </div>
        <div className="agent-panel__top-actions">
          {settings && (
            <span className="agent-chip" title="Approval mode">
              {approvalModeLabel(settings.approval_mode)}
            </span>
          )}
          {status?.enabled ? (
            <button type="button" className="secondary-action" onClick={() => void setEnabled(false)} disabled={busy !== null}>
              <Power /> Turn off
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={() => setConfirmEnable(true)}
              disabled={busy !== null || !status || status.emergency_stopped}
            >
              <Power /> Turn on
            </button>
          )}
          <button type="button" className="secondary-action" onClick={() => void refresh()} disabled={busy !== null}>
            <RefreshCw /> Refresh
          </button>
        </div>
      </div>

      <p className="agent-lede">
        The agent is off by default and runs only when you start a task. It drives its own fresh Chromium profile — never
        your normal browser, cookies or saved passwords. Everything it reads from pages is untrusted data.
      </p>

      {!status && (
        <p className="agent-error" role="alert">
          The local backend is offline, so the computer agent cannot load. Start FastAPI at 127.0.0.1:8000 and refresh.
        </p>
      )}

      {status?.emergency_stopped && (
        <div className="agent-error" role="alert">
          <p>
            Emergency stop is latched. The agent stays off and no new task will run until you reset it.
          </p>
          {!confirmReset ? (
            <button type="button" className="secondary-action" onClick={() => setConfirmReset(true)}>
              Reset emergency stop
            </button>
          ) : (
            <div className="agent-confirm-row">
              <span>Reset the latch and leave the agent off?</span>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setConfirmReset(false)
                  void resetEmergency()
                }}
                disabled={busy !== null}
              >
                Yes, reset
              </button>
              <button type="button" className="secondary-action" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {confirmEnable && !status?.enabled && (
        <div className="agent-confirm" role="alert">
          <ShieldAlert />
          <div>
            <strong>Turn on the computer agent?</strong>
            <p>
              It can open its own browser and act only after you start a task and approve its plan. Tier 2 steps still
              need separate approval. Tier 3 actions stay blocked.
            </p>
            <div className="agent-confirm-row">
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setConfirmEnable(false)
                  void setEnabled(true)
                }}
                disabled={busy !== null}
              >
                Turn on agent
              </button>
              <button type="button" className="secondary-action" onClick={() => setConfirmEnable(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="agent-error" role="alert">{error}</p>}

      <section className="agent-section">
        <div className="agent-section-head">
          <h3><ClipboardList /> New task</h3>
          <button type="button" className="secondary-action" onClick={() => setText(DEMO_TASK)} disabled={busy !== null}>
            Fill demo task
          </button>
        </div>
        <label className="agent-field" htmlFor="agent-task">
          <span>Describe what BOZZ should do in its own browser</span>
          <textarea
            id="agent-task"
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={DEMO_TASK}
            disabled={!status?.enabled || active}
          />
        </label>
        <label className="agent-toggle">
          <span>
            Dry run
            <small>Plan and record the steps without touching the browser. First run is a dry run by default.</small>
          </span>
          <input
            type="checkbox"
            checked={effectiveDryRun}
            onChange={(event) => setDryRun(event.target.checked)}
            disabled={!status?.enabled || active}
          />
        </label>
        <label className={`agent-toggle ${canShareScreenshots ? '' : 'is-disabled'}`}>
          <span>
            <Camera /> Allow screenshots to be sent to the AI provider for this task
            <small>
              {canShareScreenshots
                ? 'Default off. In this milestone no code uploads a screenshot even when this is on; they stay in the local BOZZ folder.'
                : 'Turn on the screenshot master switch in Settings first. Milestone 1 has no upload path at all.'}
            </small>
          </span>
          <input
            type="checkbox"
            checked={allowScreenshots && canShareScreenshots}
            onChange={(event) => setAllowScreenshots(event.target.checked)}
            disabled={!canShareScreenshots || !status?.enabled || active}
          />
        </label>
        {allowScreenshots && canShareScreenshots && (
          <label className="agent-field" htmlFor="agent-screenshot-provider">
            <span>Name the AI provider that may receive a screenshot</span>
            <input
              id="agent-screenshot-provider"
              value={screenshotProvider}
              onChange={(event) => setScreenshotProvider(event.target.value)}
              placeholder="e.g. Ollama (local) or the provider you configured"
              maxLength={80}
            />
          </label>
        )}
        <div className="agent-actions">
          <button type="button" className="primary-action" onClick={() => void start()} disabled={!canStart}>
            <Play /> {busy === 'start' ? 'Planning…' : 'Plan task'}
          </button>
          {active && (
            <span className="agent-note">A task is already active. Pause, cancel or stop it before starting another.</span>
          )}
        </div>
        <p className="agent-note">
          Planning uses the existing local AI adapter. The backend validates the strict JSON plan, rejects blocked
          actions and never runs a step before the full plan is approved.
        </p>
      </section>

      {task && (
        <>
          <section className="agent-section agent-task">
            <div className="agent-section-head">
              <h3><Globe /> {task.task}</h3>
              <span className={`agent-state-chip is-${task.state}`}>{stateLabel(task.state)}</span>
            </div>
            <div className="agent-task-meta">
              <span>Planner: <strong>{task.planner ?? '—'}</strong></span>
              <span>Provider: <strong>{task.provider ?? '—'}</strong>{task.model ? ` · ${task.model}` : ''}</span>
              <span>{task.dry_run ? 'Dry run' : 'Live run'}</span>
              <span>Elapsed: <strong>{formatElapsed(task.elapsed_ms)}</strong></span>
              <span>Steps: <strong>{task.steps.length}</strong></span>
              <span>App: <strong>{task.current_application || step?.application || '—'}</strong></span>
              <span>Started: {formatTime(task.started_at ?? task.created_at)}</span>
            </div>

            <div className="agent-progress" aria-label={`${progress}% of steps verified`}>
              <span style={{ width: `${progress}%` }} />
              <small>{task.steps.filter((item) => item.status === 'verified').length} of {task.steps.length} verified</small>
            </div>

            {task.plan && (
              <div className="agent-tier-counts">
                <span className="agent-tier is-tier-1">{planTierCounts(task).tier1} read-only</span>
                <span className="agent-tier is-tier-2">{planTierCounts(task).tier2} need approval</span>
                <span className="agent-tier is-tier-3">{planTierCounts(task).tier3} blocked</span>
              </div>
            )}

            {task.handoff && (
              <div className="agent-handoff" role="status">
                <ShieldAlert />
                <div>
                  <strong>Please log in yourself, then press Continue.</strong>
                  <p>
                    The agent reached a login or payment screen. It never types passwords or payment details. It also
                    does not use your normal browser session.
                  </p>
                  <button type="button" className="primary-action" onClick={() => void resume()} disabled={busy !== null}>
                    <Play /> Continue
                  </button>
                </div>
              </div>
            )}

            {task.injection_warnings.length > 0 && (
              <div className="agent-injection" role="alert">
                <ShieldAlert />
                <div>
                  <strong>This page tried to instruct the agent. Ignored.</strong>
                  <ul>
                    {task.injection_warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <p>Page content is data, never a command. The warning is recorded in the local audit log.</p>
                </div>
              </div>
            )}

            {task.notes.length > 0 && (
              <ul className="agent-notes">
                {task.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            <div className="agent-actions">
              {!task.paused && (task.state === 'running' || task.state === 'awaiting_approval' || task.state === 'verifying') && (
                <button type="button" className="secondary-action" onClick={() => void pause()} disabled={busy !== null}>
                  <Pause /> Pause
                </button>
              )}
              {(task.paused || task.state === 'paused') && (
                <button type="button" className="primary-action" onClick={() => void resume()} disabled={busy !== null}>
                  <Play /> Resume
                </button>
              )}
              {isActiveTask(task) && (
                <button type="button" className="secondary-action" onClick={() => void cancel()} disabled={busy !== null}>
                  <Square /> Cancel task
                </button>
              )}
              <button
                type="button"
                className="secondary-action is-danger"
                onClick={() => void emergencyStop('the Agent panel emergency stop')}
                disabled={busy !== null}
              >
                <OctagonAlert /> Emergency Stop
              </button>
            </div>
          </section>

          {task.state === 'awaiting_plan_approval' && (
            <AgentPlanView
              task={task}
              busy={busy !== null}
              onApprove={() => void approvePlan()}
              onEdit={editPlan}
              onReject={() => void rejectPlan()}
            />
          )}

          {task.pending_approval && task.state === 'awaiting_approval' && (
            <PendingApprovalCard
              task={task}
              busy={busy !== null}
              onResolve={(approve) => void approveStep(approve)}
            />
          )}

          {task.steps.length > 0 && (
            <section className="agent-section" aria-label="Live steps">
              <div className="agent-section-head">
                <h3><ClipboardList /> Steps</h3>
                <span className="agent-chip">{step ? `Current: ${step.goal}` : stateLabel(task.state)}</span>
              </div>
              <ol className="agent-step-list">
                {task.steps.map((item) => (
                  <StepRow key={item.id} step={item} task={task} />
                ))}
              </ol>
            </section>
          )}

          {task.report && (
            <section className={`agent-report tone-${reportTone(task.report.status)}`} aria-label="Task report">
              <div className="agent-section-head">
                <h3>
                  {task.report.status === 'Done' ? <CheckCircle2 /> : <AlertTriangle />}
                  {task.report.status}
                </h3>
                <LevelChip level={task.report.result_level} />
              </div>
              <p className="agent-report__summary">{task.report.summary}</p>
              <div className="agent-task-meta">
                <span>Elapsed: <strong>{formatElapsed(task.report.elapsed_ms)}</strong></span>
                <span>Steps executed: <strong>{task.report.steps_executed}</strong></span>
                <span>Injections ignored: <strong>{task.report.injections_ignored}</strong></span>
                <span>Screenshots shared: <strong>{task.report.screenshots_shared ? 'yes' : 'no'}</strong></span>
                <span>Provider: <strong>{task.report.provider}</strong>{task.report.model ? ` · ${task.report.model}` : ''}</span>
              </div>
              <p className={`agent-report__verify ${task.report.verification.ok ? 'is-ok' : 'is-bad'}`}>
                {task.report.verification.ok ? <CheckCircle2 /> : <AlertTriangle />}
                {task.report.verification.source}: {task.report.verification.detail}
              </p>
              {task.report.notes.length > 0 && (
                <ul className="agent-notes">
                  {task.report.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              <p className="agent-note">
                “Done” appears only when every completed step is verified by real evidence. Otherwise BOZZ says
                “Executed, not verified” or “Could not confirm”.
              </p>
            </section>
          )}
        </>
      )}

      <section className="agent-section">
        <div className="agent-section-head">
          <h3><History /> Task history</h3>
          <span className="agent-chip">{tasks.length}</span>
        </div>
        {tasks.length === 0 ? (
          <p className="agent-note">No agent tasks yet. Plans, approvals, actions, blocks and reports are recorded locally.</p>
        ) : (
          <ul className="agent-history">
            {tasks.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={task?.id === item.id ? 'is-active' : ''}
                  onClick={() => void selectTask(item.id)}
                  disabled={busy !== null}
                >
                  <span>{item.task}</span>
                  <small>
                    {stateLabel(item.state)} · {item.dry_run ? 'dry run' : 'live'} · {formatTime(item.updated_at)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="agent-section">
        <h3><ShieldCheck /> Safety and privacy</h3>
        <ul className="agent-safety">
          <li><ShieldCheck /> Off by default with its own switch; it runs only while a task you started is active.</li>
          <li><ShieldCheck /> Tier 1 read-only steps run after plan approval; Tier 2 steps ask every time; Tier 3 is blocked with no override.</li>
          <li><ShieldCheck /> Its own fresh Playwright profile in the BOZZ data folder — never your Chrome profile, cookies or saved passwords.</li>
          <li><ShieldCheck /> Passwords and payment details are never typed. Login and payment screens stop for a manual hand-off.</li>
          <li><ShieldCheck /> Screenshots stay local unless you enable per-task sharing; Milestone 1 has no upload path.</li>
          <li><ShieldCheck /> Pages, screenshots, files and app content are untrusted data. Text that tells the agent to change rules is ignored and logged.</li>
          <li><ShieldCheck /> Only allowlisted domains and the local mock test page; file://, chrome://, javascript:, data:, admin ports and private ranges are blocked.</li>
        </ul>
        <p className="agent-note">
          Browser: {status?.adapters.browser.installed ? 'Playwright Chromium installed' : 'Playwright Chromium not installed'}
          {' · '}
          Own profile: {status?.adapters.browser.profile ?? 'not loaded'}
        </p>
        <p className="agent-note">
          <Link to="/settings#computer-agent">Agent settings</Link>
          {' · '}
          <Link to="/reliability">Measured reliability report</Link>
        </p>
      </section>

      <p className="agent-footnote">
        {busy ? `${busyLabel(busy)}…` : status?.enabled ? 'Ready when you start a task.' : 'Agent off. Nothing is running.'}
      </p>
    </div>
  )
}
