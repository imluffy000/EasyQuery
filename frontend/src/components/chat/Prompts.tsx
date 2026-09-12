/**
 * Inline prompts: operational status, clarification, and cost confirmation.
 *
 * Clarification is deliberately inline and compact rather than a modal -- a
 * one-word question should not take over the screen (spec section 13).
 */

import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import { Collapse, PopIn, Reveal, Stagger, StaggerItem } from '@/components/motion'
import { Button } from '@/components/ui'
import { DISTANCE, DURATION, EASE_OUT, usePrefersReducedMotion } from '@/lib/motion'
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

/**
 * The pipeline as the backend reports it. Each step is a real event from the
 * stream, appended as it arrives -- nothing is scheduled, estimated or
 * filled in ahead of the server, so the trail can never claim progress that
 * has not happened. Motion only marks the handover: the new step slides in,
 * and the step it replaces settles its spinner into a check.
 */
export function StatusTrail({ events }: { events: StreamEventName[] }) {
  const reduced = usePrefersReducedMotion()
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
          <m.li
            key={`${event}-${i}`}
            initial={reduced ? false : { opacity: 0, x: -DISTANCE.nudge * 2 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className={cn(
              'flex items-center gap-2 font-mono text-2xs transition-colors duration-base',
              done ? 'text-subtle' : 'text-fg',
            )}
          >
            <span className="relative grid h-3 w-3 shrink-0 place-items-center">
              {done ? (
                <PopIn key="done">
                  <Check className="h-3 w-3 text-ok" aria-hidden />
                </PopIn>
              ) : (
                <Loader2 key="active" className="h-3 w-3 animate-spin text-accent" aria-hidden />
              )}
            </span>
            {STATUS_LABEL[event]}
          </m.li>
        )
      })}
    </ol>
  )
}

/**
 * Clarification, from question to answer.
 *
 * The prompt arrives with its options staggered in, so the question is read
 * before the choices. Choosing marks the pick, then folds the options away
 * into a one-line record of the answer while the follow-up query starts below.
 * The fold is the confirmation: the question is settled, and the page says
 * which way. "Change" reopens it, which asks again exactly as before.
 */
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
  const [answered, setAnswered] = useState<{ label: string; value: string } | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  // The control that had focus is about to be folded away. Hand focus to the
  // element that replaces it, so a keyboard user is not dropped onto <body>.
  const moveFocus = useRef(false)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    if (answered) summaryRef.current?.focus()
    else (firstOptionRef.current ?? changeRef.current)?.focus()
  }, [answered])

  const choose = (label: string, value: string) => {
    moveFocus.current = true
    setAnswered({ label, value })
    onAnswer(value)
  }

  return (
    <Reveal className="mt-2 border border-info/30 bg-info/5 p-3">
      <p className="text-sm text-fg">{clarification.question}</p>
      {clarification.dimension && (
        <p className="mt-0.5 text-2xs text-subtle">
          Ambiguous: {clarification.dimension.replace(/_/g, ' ')}
        </p>
      )}

      <Collapse open={!answered}>
        <Stagger className="flex flex-wrap gap-1.5 pt-2.5">
          {clarification.options.map((option, i) => (
            <StaggerItem key={option.value} index={i + 1} className="inline-flex">
              <Button
                ref={i === 0 ? firstOptionRef : undefined}
                size="sm"
                variant="secondary"
                disabled={disabled}
                title={option.description ?? undefined}
                onClick={() => choose(option.label, option.value)}
              >
                {option.label}
              </Button>
            </StaggerItem>
          ))}
        </Stagger>

        {clarification.allow_free_text && (
          <form
            className="flex gap-1.5 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (custom.trim()) choose(custom.trim(), custom.trim())
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
      </Collapse>

      <Collapse open={Boolean(answered)}>
        {answered && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            className="mt-2.5 flex flex-wrap items-center gap-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="inline-flex items-center gap-1.5 border border-accent/40 bg-accent/10 px-2 py-0.5 text-fg">
              <PopIn>
                <Check className="h-3 w-3 text-accent" aria-hidden />
              </PopIn>
              <span className="sr-only">Answered:</span>
              {answered.label}
            </span>
            <button
              ref={changeRef}
              type="button"
              onClick={() => {
                moveFocus.current = true
                setAnswered(null)
              }}
              className="link-underline cursor-pointer text-2xs text-subtle hover:text-fg"
            >
              Change answer
            </button>
          </div>
        )}
      </Collapse>
    </Reveal>
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
    <Reveal className="mt-2 border border-warn/30 bg-warn/5 p-3">
      <div className="flex items-start gap-2">
        <PopIn className="mt-0.5 shrink-0">
          <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
        </PopIn>
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
    </Reveal>
  )
}
