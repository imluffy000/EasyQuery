import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CornerDownLeft, Database, PanelRightOpen, Square } from 'lucide-react'

import { ClarificationPrompt, ConfirmationPrompt, StatusTrail } from '@/components/chat/Prompts'
import { QueryDetailsDrawer, SqlDisclosure, TrustBar } from '@/components/chat/SqlPanel'
import { ChartView } from '@/components/result/ChartView'
import { ResultTable } from '@/components/result/ResultTable'
import { Button, EmptyState, ErrorState, SuccessState } from '@/components/ui'
import { ApiRequestError, streamChat } from '@/lib/api'
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

  const busy = turns.some((t) => t.streaming)

  // A typed question that has not been sent, or a query still running, is
  // work the user would lose by navigating away.
  useUnsavedGuard('chat-composer', input.trim() !== '' || busy)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

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
              <div className="py-10">
                <h2 className="text-sm font-medium text-fg">Ask a question about your data</h2>
                <p className="mt-1 text-xs text-muted">
                  Questions are translated to read-only SQL, validated, and explained.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {EXAMPLES.map((example) => (
                    <li key={example}>
                      <button
                        onClick={() => void ask(example)}
                        className="w-full border border-border bg-surface px-3 py-2
                                   text-left text-xs text-muted cursor-pointer transition-colors
                                   hover:border-border-strong hover:text-fg"
                      >
                        {example}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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
                  variant="secondary"
                  onClick={() => abortRef.current?.abort()}
                  title="Stop"
                >
                  <Square className="h-3.5 w-3.5" aria-hidden /> Stop
                </Button>
              ) : (
                <Button variant="primary" onClick={submit} disabled={!input.trim()}>
                  <CornerDownLeft className="h-3.5 w-3.5" aria-hidden /> Ask
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

  return (
    <article className="animate-fade-in">
      <p className="text-sm font-medium text-fg">{turn.question}</p>

      <div className="mt-2 border-l-2 border-border pl-3">
        {turn.streaming && <StatusTrail events={turn.events} />}

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
              <>
                {/* The result table shows what came back, but not that the run
                    itself succeeded -- an empty result and a failed query look
                    alike without this. */}
                {response.result && (
                  <div className="mb-3">
                    <SuccessState
                      message="Query executed successfully."
                      details={`${formatNumber(response.result.row_count)} rows in ${formatDuration(response.result.duration_ms)}.`}
                    />
                  </div>
                )}

                {response.answer && (
                  <p className="whitespace-pre-wrap text-sm text-fg">{response.answer}</p>
                )}

                {response.errors.length > 0 && !response.answer && (
                  <ErrorState message={response.errors[response.errors.length - 1]!.message} />
                )}

                <TrustBar response={response} />

                {response.result && response.visualization &&
                  response.visualization.type !== 'table' && (
                    <div className="mt-3">
                      <ChartView spec={response.visualization} result={response.result} />
                    </div>
                  )}

                {response.result && (
                  <div className="mt-3">
                    <ResultTable result={response.result} className="max-h-80" />
                  </div>
                )}

                <SqlDisclosure response={response} />

                <button
                  onClick={() => onShowDetails(response)}
                  className={cn(
                    'mt-1.5 inline-flex items-center gap-1 text-2xs text-subtle',
                    'cursor-pointer hover:text-fg',
                  )}
                >
                  <PanelRightOpen className="h-3 w-3" aria-hidden /> Details
                </button>
              </>
            )}
          </>
        )}
      </div>
    </article>
  )
}
