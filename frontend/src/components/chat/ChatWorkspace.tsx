import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'
import { Check, CornerDownLeft, Database, PanelRightOpen, Square } from 'lucide-react'

import { ClarificationPrompt, ConfirmationPrompt, StatusTrail } from '@/components/chat/Prompts'
import { QueryDetailsDrawer, SqlDisclosure, TrustBar } from '@/components/chat/SqlPanel'
import { Reveal, Stagger, StaggerItem, SwapText } from '@/components/motion'
import { ChartView } from '@/components/result/ChartView'
import { ResultTable } from '@/components/result/ResultTable'
import { Button, EmptyState, ErrorState, SuccessState } from '@/components/ui'
import { ApiRequestError, streamChat } from '@/lib/api'
import { DURATION, EASE_OUT, useFlash, usePrefersReducedMotion } from '@/lib/motion'
import { useUnsavedGuard } from '@/lib/unsavedChanges'
import { cn, formatDuration, formatNumber } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { ChatResponse, StreamEventName } from '@/types/api'

const EXAMPLES = [
  'How many users signed up this month?',
  'Show monthly revenue for this year.',
  'Which products have the highest return rate?',
  "Find customers who haven't ordered in 90 days.",
]

interface Turn {
  id: string
  question: string
  events: StreamEventName[]
  response: ChatResponse | null
  error: string | null
  streaming: boolean
}

export function ChatWorkspace({ canOverrideCost }: { canOverrideCost: boolean }) {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [detailsFor, setDetailsFor] = useState<ChatResponse | null>(null)

  /** Dismiss a pending cost confirmation. The Cancel button on a
   *  "this may scan a lot of data" warning must not be a no-op. */
  const cancelConfirmation = useCallback((turnId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId && t.response
          ? {
              ...t,
              response: { ...t.response, awaiting_confirmation: false },
              error: 'Cancelled before running. The query was not executed.',
            }
          : t,
      ),
    )
  }, [])

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reduced = usePrefersReducedMotion()

  const busy = turns.some((t) => t.streaming)

  // Idle -> Running -> Completed on the composer's own button. "Completed" is
  // flashed only when a turn actually settled with a response, never on a
  // timer and never for a failure or a cancel.
  const [completed, flashCompleted] = useFlash<'done'>(1400)
  const wasBusy = useRef(false)
  useEffect(() => {
    const settled = wasBusy.current && !busy
    wasBusy.current = busy
    const last = turns[turns.length - 1]
    if (settled && last?.response && !last.error) flashCompleted('done')
  }, [busy, turns, flashCompleted])

  // A typed question that has not been sent, or a query still running, is
  // work the user would lose by navigating away.
  useUnsavedGuard('chat-composer', input.trim() !== '' || busy)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' })
  }, [turns, reduced])

  // Grow the composer with its content up to the max-height cap.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  const ask = useCallback(
    async (
      question: string,
      opts: { clarificationAnswer?: string; approveExpensive?: boolean } = {},
    ) => {
      if (!workspaceId || !databaseId || !question.trim()) return

      const id = crypto.randomUUID()
      setTurns((prev) => [
        ...prev,
        { id, question, events: [], response: null, error: null, streaming: true },
      ])

      const update = (patch: Partial<Turn>) =>
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamChat(
          workspaceId,
          {
            question,
            database_id: databaseId,
            conversation_id: conversationId,
            clarification_answer: opts.clarificationAnswer ?? null,
            approve_expensive: opts.approveExpensive ?? false,
          },
          {
            signal: controller.signal,
            onEvent: (event, data) => {
              if (event === 'result') {
                const response = data as ChatResponse
                setConversationId(response.conversation_id)
                update({ response, streaming: false })
                // History and analytics now have a new row.
                queryClient.invalidateQueries({ queryKey: ['history'] })
                queryClient.invalidateQueries({ queryKey: ['analytics'] })
                return
              }
              if (event === 'error') {
                const payload = data as { message?: string } | null
                update({ error: payload?.message ?? 'The request failed.', streaming: false })
                return
              }
              setTurns((prev) =>
                prev.map((t) => (t.id === id ? { ...t, events: [...t.events, event] } : t)),
              )
            },
          },
        )
      } catch (err) {
        if (controller.signal.aborted) {
          update({ error: 'Cancelled.', streaming: false })
        } else {
          update({
            error:
              err instanceof ApiRequestError
                ? err.message
                : "We couldn't execute this query. Please review the query or database connection.",
            streaming: false,
          })
        }
      } finally {
        // Guard against a late finally from a superseded request.
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, streaming: false } : t)))
        abortRef.current = null
      }
    },
    [workspaceId, databaseId, conversationId, queryClient],
  )

  const submit = () => {
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    void ask(question)
  }

  if (!databaseId) {
    return (
      <EmptyState
        icon={<Database className="h-7 w-7" />}
        title="No database selected"
        description="Connect a PostgreSQL or Supabase database to start asking questions about your data."
        action={
          <Button variant="primary" onClick={() => navigate('/databases')}>
            Connect database
          </Button>
        }
      />
    )
  }

  // A screen-reader user otherwise gets no signal that the query finished,
  // how many rows came back, or that it failed. The region is mounted for the
  // life of the workspace: content inserted together with its own live region
  // is generally not announced.
  const last = turns[turns.length - 1]
  const liveStatus = !last
    ? ''
    : last.error
      ? `Query failed. ${last.error}`
      : last.streaming
        ? 'Working on the query.'
        : last.response?.awaiting_clarification
          ? 'A clarification is needed before the query can run.'
          : last.response?.awaiting_confirmation
            ? 'This query needs confirmation before running.'
            : last.response?.result
              ? `Answer ready. ${formatNumber(last.response.result.row_count)} rows in ${formatDuration(last.response.result.duration_ms)}.`
              : last.response
                ? 'Answer ready.'
                : ''

  return (
    <div className="flex h-full">
      <h1 className="sr-only">Chat</h1>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveStatus}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-5 py-5">
            {turns.length === 0 && (
              <Stagger className="py-10">
                <StaggerItem as="h2" index={0} className="text-sm font-medium text-fg">
                  Ask a question about your data
                </StaggerItem>
                <StaggerItem as="p" index={1} className="mt-1 text-xs text-muted">
                  Questions are translated to read-only SQL, validated, and explained.
                </StaggerItem>
                <ul className="mt-4 space-y-1.5">
                  {EXAMPLES.map((example, i) => (
                    <StaggerItem as="li" key={example} index={i + 2}>
                      <button
                        onClick={() => void ask(example)}
                        className="lift group flex w-full items-center justify-between gap-3 border border-border
                                   bg-surface px-3 py-2 text-left text-xs text-muted cursor-pointer
                                   hover:text-fg"
                      >
                        {example}
                        <CornerDownLeft
                          className="h-3 w-3 shrink-0 text-subtle opacity-0 transition-opacity duration-base group-hover:opacity-100 group-focus-visible:opacity-100"
                          aria-hidden
                        />
                      </button>
                    </StaggerItem>
                  ))}
                </ul>
              </Stagger>
            )}

            <div className="space-y-6">
              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  canOverrideCost={canOverrideCost}
                  onClarify={(answer) =>
                    void ask(turn.question, { clarificationAnswer: answer })
                  }
                  onApprove={() => void ask(turn.question, { approveExpensive: true })}
                  onShowDetails={setDetailsFor}
                  onCancelConfirm={() => cancelConfirmation(turn.id)}
                />
              ))}
            </div>
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-surface px-5 py-3">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                rows={1}
                placeholder="Ask a follow-up..."
                aria-label="Ask a question"
                className="field max-h-32 min-h-[2.25rem] resize-none py-2 font-sans"
              />
              {busy ? (
                <Button
                  key="stop"
                  variant="secondary"
                  onClick={() => abortRef.current?.abort()}
                  title="Stop"
                >
                  <SwapText state="running">
                    <Square className="h-3.5 w-3.5" aria-hidden /> Stop
                  </SwapText>
                </Button>
              ) : (
                <Button key="ask" variant="primary" onClick={submit} disabled={!input.trim()}>
                  {/* Completed shows as a tick for a moment; the word stays
                      "Ask" so the control never changes its name mid-use. */}
                  <SwapText state={completed ?? 'idle'}>
                    {completed ? (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
                    )}{' '}
                    Ask
                  </SwapText>
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-2xs text-subtle">
              Enter to send, Shift+Enter for a new line. Queries run read-only.
            </p>
          </div>
        </div>
      </div>

      {detailsFor && (
        <QueryDetailsDrawer response={detailsFor} onClose={() => setDetailsFor(null)} />
      )}
    </div>
  )
}

function TurnView({
  turn,
  canOverrideCost,
  onClarify,
  onApprove,
  onShowDetails,
  onCancelConfirm,
}: {
  turn: Turn
  canOverrideCost: boolean
  onClarify: (answer: string) => void
  onApprove: () => void
  onShowDetails: (response: ChatResponse) => void
  onCancelConfirm: () => void
}) {
  const response = turn.response
  const reduced = usePrefersReducedMotion()

  return (
    <Reveal as="article">
      <p className="text-sm font-medium text-fg">{turn.question}</p>

      <div className="mt-2 border-l-2 border-border pl-3">
        {/* The trail folds away as the answer takes its place, so running
            into results reads as one continuous motion rather than a swap.
            No `initial={false}` here: it would also block each step's own
            slide-in, since steps mount inside this presence boundary. */}
        <AnimatePresence>
          {turn.streaming && (
            <m.div
              key="trail"
              className="overflow-hidden"
              exit={{
                height: 0,
                opacity: 0,
                transition: { duration: reduced ? 0 : DURATION.base, ease: EASE_OUT },
              }}
            >
              <StatusTrail events={turn.events} />
            </m.div>
          )}
        </AnimatePresence>

        {turn.error && (
          <div className="mt-1">
            <ErrorState message={turn.error} />
          </div>
        )}

        {response && (
          <>
            {response.awaiting_clarification && response.clarification ? (
              <ClarificationPrompt clarification={response.clarification} onAnswer={onClarify} />
            ) : response.awaiting_confirmation && response.cost ? (
              <ConfirmationPrompt
                cost={response.cost}
                canOverride={canOverrideCost}
                onApprove={onApprove}
                onCancel={onCancelConfirm}
              />
            ) : (
              // Arrival order is reading order: that it worked, what it
              // means, how far to trust it, then the data and the SQL behind
              // it. Each block waits a beat for the one above.
              <Stagger>
                {/* The result table shows what came back, but not that the run
                    itself succeeded -- an empty result and a failed query look
                    alike without this. */}
                {response.result && (
                  <StaggerItem index={0} className="mb-3">
                    <SuccessState
                      message="Query executed successfully."
                      details={`${formatNumber(response.result.row_count)} rows in ${formatDuration(response.result.duration_ms)}.`}
                    />
                  </StaggerItem>
                )}

                {response.answer && (
                  <StaggerItem as="p" index={1} className="whitespace-pre-wrap text-sm text-fg">
                    {response.answer}
                  </StaggerItem>
                )}

                {response.errors.length > 0 && !response.answer && (
                  <StaggerItem index={1}>
                    <ErrorState message={response.errors[response.errors.length - 1]!.message} />
                  </StaggerItem>
                )}

                <StaggerItem index={2} variant="fade">
                  <TrustBar response={response} />
                </StaggerItem>

                {response.result && response.visualization &&
                  response.visualization.type !== 'table' && (
                    <StaggerItem index={3} className="mt-3">
                      <ChartView spec={response.visualization} result={response.result} />
                    </StaggerItem>
                  )}

                {response.result && (
                  // Not a clip reveal: the table has a fullscreen mode that is
                  // position: fixed, and must not sit under a mask mid-reveal.
                  <StaggerItem index={4} className="mt-3">
                    <ResultTable result={response.result} className="max-h-80" />
                  </StaggerItem>
                )}

                <StaggerItem index={5} variant="fade">
                  <SqlDisclosure response={response} />

                  <button
                    onClick={() => onShowDetails(response)}
                    className={cn(
                      'group mt-1.5 inline-flex items-center gap-1 text-2xs text-subtle',
                      'cursor-pointer transition-colors hover:text-fg',
                    )}
                  >
                    <PanelRightOpen
                      className="h-3 w-3 transition-transform duration-base motion-safe:group-hover:translate-x-0.5"
                      aria-hidden
                    />{' '}
                    Details
                  </button>
                </StaggerItem>
              </Stagger>
            )}
          </>
        )}
      </div>
    </Reveal>
  )
}
