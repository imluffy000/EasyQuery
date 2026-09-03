/**
 * Inline prompts: operational status, clarification, and cost confirmation.
 *
 * Clarification is deliberately inline and compact rather than a modal -- a
 * one-word question should not take over the screen (spec section 13).
 */

import { useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui'
import { cn, formatNumber } from '@/lib/utils'
import type { Clarification, CostAssessment, StreamEventName } from '@/types/api'

/** Human-readable labels for pipeline status. Status only, never reasoning. */
const STATUS_LABEL: Partial<Record<StreamEventName, string>> = {
  connected: 'Connected',
  understanding_question: 'Understanding the question',
  retrieving_schema: 'Reading schema',
  planning_query: 'Preparing the query',
  generating_sql: 'Writing SQL',
  validating_sql: 'Validating SQL',
  checking_cost: 'Checking query cost',
  executing_query: 'Running query',
  analyzing_results: 'Analysing results',
  clarification_required: 'Needs clarification',
  confirmation_required: 'Needs confirmation',
  complete: 'Complete',
  error: 'Failed',
}

export function StatusTrail({ events }: { events: StreamEventName[] }) {
  const visible = events.filter((e) => STATUS_LABEL[e] && e !== 'connected')
  if (visible.length === 0) return null

  const current = visible[visible.length - 1]
  const settled = current === 'complete' || current === 'error'

  return (
    <ol className="space-y-1">
      {visible.map((event, i) => {
        const isLast = i === visible.length - 1
        const done = !isLast || settled
        return (
          <li
            key={`${event}-${i}`}
            className={cn(
              'flex items-center gap-2 font-mono text-2xs',
              done ? 'text-subtle' : 'text-fg',
            )}
          >
            {done ? (
              <Check className="h-3 w-3 shrink-0 text-ok" aria-hidden />
            ) : (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" aria-hidden />
            )}
            {STATUS_LABEL[event]}
          </li>
        )
      })}
    </ol>
  )
}

export function ClarificationPrompt({
  clarification,
  onAnswer,
  disabled,
}: {
  clarification: Clarification
  onAnswer: (answer: string) => void
  disabled?: boolean
}) {
  const [custom, setCustom] = useState('')

  return (
    <div className="mt-2 border border-info/30 bg-info/5 p-3">
      <p className="text-sm text-fg">{clarification.question}</p>
      {clarification.dimension && (
        <p className="mt-0.5 text-2xs text-subtle">
          Ambiguous: {clarification.dimension.replace(/_/g, ' ')}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {clarification.options.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="secondary"
            disabled={disabled}
            title={option.description ?? undefined}
            onClick={() => onAnswer(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {clarification.allow_free_text && (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom.trim()) onAnswer(custom.trim())
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Or describe what you mean"
            aria-label="Custom clarification"
            disabled={disabled}
            className="field h-7 text-xs"
          />
          <Button size="sm" type="submit" variant="primary" disabled={disabled || !custom.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  )
}

export function ConfirmationPrompt({
  cost,
  onApprove,
  onCancel,
  canOverride,
  disabled,
}: {
  cost: CostAssessment
  onApprove: () => void
  onCancel: () => void
  canOverride: boolean
  disabled?: boolean
}) {
  return (
    <div className="mt-2 border border-warn/30 bg-warn/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg">This query may scan a large amount of data.</p>
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-2xs text-muted">
            <div className="flex gap-1">
              <dt>estimated rows:</dt>
              <dd className="text-fg">{formatNumber(cost.estimated_rows)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>plan cost:</dt>
              <dd className="text-fg">{cost.total_cost.toFixed(0)}</dd>
            </div>
            {cost.scanned_relations.length > 0 && (
              <div className="flex gap-1">
                <dt>scans:</dt>
                <dd className="text-fg">{cost.scanned_relations.join(', ')}</dd>
              </div>
            )}
          </dl>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={disabled}>
              Cancel
            </Button>
            {/* Shown only with the run_expensive_query permission. */}
            {canOverride && (
              <Button size="sm" variant="primary" onClick={onApprove} disabled={disabled}>
                Run anyway
              </Button>
            )}
          </div>
          {!canOverride && (
            <p className="mt-1.5 text-2xs text-subtle">
              Your role cannot override the cost limit. Ask an admin, or narrow the question.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
