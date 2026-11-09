import { Pencil, Play, ShieldAlert, X } from 'lucide-react'
import { planTierCounts, tierLabel, tierShortLabel } from './state'
import type { AgentTask } from './types'

export function AgentPlanView({
  task,
  busy,
  onApprove,
  onEdit,
  onReject,
}: {
  task: AgentTask
  busy: boolean
  onApprove: () => void
  onEdit: () => void
  onReject: () => void
}) {
  const plan = task.plan
  if (!plan) return null
  const counts = planTierCounts(task)

  return (
    <section className="agent-plan" aria-label="Plan preview">
      <div className="agent-section-head">
        <h3><ShieldAlert /> Plan preview</h3>
        <span className="agent-chip">Awaiting your approval</span>
      </div>
      <p className="agent-note">
        Every step is listed before anything runs. Tier 3 actions are rejected by the backend, and the plan cannot
        start until you approve it here.
      </p>
      <div className="agent-tier-counts">
        <span className="agent-tier is-tier-1">{counts.tier1} read-only</span>
        <span className="agent-tier is-tier-2">{counts.tier2} need approval</span>
        <span className="agent-tier is-tier-3">{counts.tier3} blocked</span>
      </div>
      <ol className="agent-plan-steps">
        {plan.steps.map((step, index) => (
          <li key={step.id} className={step.tier >= 3 ? 'is-blocked' : step.tier === 2 ? 'is-approval' : ''}>
            <span className="agent-plan-index">{String(index + 1).padStart(2, '0')}</span>
            <div className="agent-plan-body">
              <div className="agent-plan-title">
                <strong>{step.goal}</strong>
                <span className={`agent-tier-badge is-tier-${Math.min(step.tier, 3)}`} title={tierLabel(step.tier)}>
                  {tierShortLabel(step.tier)}
                </span>
              </div>
              <p className="agent-plan-meta">
                {step.application} · <code>{step.action.type}</code> · method {step.method}
              </p>
              {Object.keys(step.action.params).length > 0 && (
                <p className="agent-plan-params">
                  {Object.entries(step.action.params)
                    .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`)
                    .join(' · ')}
                </p>
              )}
              <p className="agent-plan-expect">Expected: {step.expected_result}</p>
              {step.verify && <p className="agent-plan-verify">Check: {step.verify.check} = {step.verify.value}</p>}
              {step.dependencies.length > 0 && (
                <p className="agent-plan-deps">After: {step.dependencies.join(', ')}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {plan.notes.length > 0 && (
        <ul className="agent-plan-notes">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="agent-actions">
        <button type="button" className="primary-action" onClick={onApprove} disabled={busy || counts.tier3 > 0}>
          <Play /> Approve and run
        </button>
        <button type="button" className="secondary-action" onClick={onEdit} disabled={busy}>
          <Pencil /> Edit task
        </button>
        <button type="button" className="secondary-action" onClick={onReject} disabled={busy}>
          <X /> Reject plan
        </button>
      </div>
      {counts.tier3 > 0 && (
        <p className="agent-error" role="alert">
          This plan contains a Tier 3 step. The backend would reject it; reject the plan and describe a safer task.
        </p>
      )}
    </section>
  )
}
