import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CornerDownLeft, Database, PanelRightOpen, Square } from 'lucide-react'

import { ClarificationPrompt, ConfirmationPrompt, StatusTrail } from '@/components/chat/Prompts'
import { QueryDetailsDrawer, SqlDisclosure, TrustBar } from '@/components/chat/SqlPanel'
import { ChartView } from '@/components/result/ChartView'
import { ResultTable } from '@/components/result/ResultTable'
import { Button, EmptyState, ErrorState } from '@/components/ui'
import { ApiRequestError, streamChat } from '@/lib/api'
import { cn } from '@/lib/utils'
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

  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [detailsFor, setDetailsFor] = useState<ChatResponse | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const busy = turns.some((t) => t.streaming)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

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
            error: err instanceof ApiRequestError ? err.message : 'The request failed.',
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
          <Button variant="primary" onClick={() => (window.location.href = '/databases')}>
            Connect database
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full">
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
                        className="w-full rounded border border-border bg-surface px-3 py-2
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
}: {
  turn: Turn
  canOverrideCost: boolean
  onClarify: (answer: string) => void
  onApprove: () => void
  onShowDetails: (response: ChatResponse) => void
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
                onCancel={() => undefined}
              />
            ) : (
              <>
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

                {response.result && response.result.row_count > 0 && (
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
