/**
 * Query history.
 *
 * Every control here has a real accessible name — the status filter had none
 * at all, which made it an unlabelled combobox to a screen reader. Rows group
 * by day and expand in place to show the SQL that actually ran.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, ShieldAlert } from 'lucide-react'

import { SqlViewer } from '@/components/chat/SqlPanel'
import { Collapse, Reveal, Stagger, StaggerItem } from '@/components/motion'
import { Badge, EmptyState, ErrorState, Select, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { cn, dayBucket, formatDuration, formatNumber, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { QueryRecord } from '@/types/api'

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'warn' | 'neutral'> = {
  success: 'ok',
  failed: 'danger',
  blocked: 'danger',
  needs_clarification: 'warn',
  needs_confirmation: 'warn',
}

export function HistoryPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['history', workspaceId, search, status],
    queryFn: () =>
      api.queries.history(workspaceId!, {
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        limit: '100',
      }),
    enabled: Boolean(workspaceId),
  })

  const grouped = useMemo(() => {
    const buckets = new Map<string, QueryRecord[]>()
    for (const record of data) {
      const key = dayBucket(record.created_at)
      const list = buckets.get(key)
      if (list) list.push(record)
      else buckets.set(key, [record])
    }
    // Each group carries where it starts in the page's overall order: one
    // position for its heading, then one per row.
    let start = 0
    return [...buckets.entries()].map(([bucket, records]) => {
      const entry = [bucket, records, start] as const
      start += records.length + 1
      return entry
    })
  }, [data])

  const filtered = Boolean(search || status)

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <Reveal as="header" className="mb-4 border-b border-border pb-3">
          <p className="micro">Workspace</p>
          <h1 className="mt-0.5 text-xl font-medium text-fg">Query history</h1>
          <p className="mt-0.5 text-xs text-muted">Every question asked in this workspace.</p>
        </Reveal>

        <Reveal index={1} className="mb-3 flex gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 border border-border-control bg-surface px-2.5 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
            <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions"
              aria-label="Search query history"
              className="w-full bg-transparent text-xs text-fg placeholder:text-subtle focus:outline-none"
            />
          </div>
          <div className="w-44">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 py-0"
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="blocked">Blocked</option>
              <option value="needs_clarification">Needs clarification</option>
            </Select>
          </div>
        </Reveal>

        {isError && (
          <ErrorState message="Could not load history." onRetry={() => void refetch()} />
        )}

        {isLoading && (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="panel px-3 py-2.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="mt-1.5 h-2.5 w-40" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !isError && data.length === 0 && (
          <div className="panel">
            <EmptyState
              title={filtered ? 'No matching queries' : 'No queries yet'}
              description={
                filtered
                  ? 'No query in this workspace matches the current search and status filter.'
                  : 'Questions you ask in Chat will appear here with their SQL and execution details.'
              }
            />
          </div>
        )}

        {!isLoading && !isError && data.length > 0 && (
          <p className="micro mb-2" role="status">
            <span className="tnum">{formatNumber(data.length)}</span> queries
            {filtered ? ' matching' : ''}
          </p>
        )}

        {/* Positions run across day groups, so the page staggers as one list
            and rows past the limit arrive with no delay at all. */}
        {grouped.map(([bucket, records, start]) => (
          <Stagger as="section" key={bucket} className="mb-4">
            <StaggerItem
              as="h2"
              index={start}
              variant="fade"
              className="micro mb-1.5 border-b border-border pb-1"
            >
              {bucket}
            </StaggerItem>
            <ul className="space-y-1.5">
              {records.map((record, i) => {
                const isOpen = expanded === record.id
                return (
                  <StaggerItem as="li" key={record.id} index={start + i + 1}>
                    <div className="panel overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : record.id)}
                        aria-expanded={isOpen}
                        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left
                                   transition-colors hover:bg-elevated"
                      >
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-subtle transition-transform',
                            isOpen && 'rotate-90',
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-fg">{record.question}</p>
                          <p className="font-mono text-2xs tabular-nums text-subtle">
                            {formatRelative(record.created_at)}
                            {record.duration_ms != null &&
                              ` · ${formatDuration(record.duration_ms)}`}
                            {record.row_count != null && ` · ${formatNumber(record.row_count)} rows`}
                            {record.retry_count > 0 && ` · ${record.retry_count} correction(s)`}
                          </p>
                        </div>
                        {record.was_blocked && (
                          <Badge tone="danger">
                            <ShieldAlert className="h-2.5 w-2.5" aria-hidden /> blocked
                          </Badge>
                        )}
                        <Badge tone={STATUS_TONE[record.status] ?? 'neutral'}>{record.status}</Badge>
                      </button>

                      <Collapse open={isOpen}>
                        <div className="border-t border-border bg-sunken">
                          {record.error_message && (
                            <p className="border-b border-border px-3 py-2 font-mono text-2xs text-danger">
                              {record.error_code}: {record.error_message}
                            </p>
                          )}
                          {record.assumptions.length > 0 && (
                            <div className="border-b border-border px-3 py-2">
                              <p className="micro mb-1">Assumptions</p>
                              <ul className="space-y-0.5">
                                {record.assumptions.map((a, i) => (
                                  <li key={i} className="text-2xs text-muted">
                                    {a}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(record.executed_sql || record.generated_sql) && (
                            <SqlViewer
                              sql={record.executed_sql ?? record.generated_sql ?? ''}
                              height={140}
                            />
                          )}
                        </div>
                      </Collapse>
                    </div>
                  </StaggerItem>
                )
              })}
            </ul>
          </Stagger>
        ))}
      </div>
    </div>
  )
}
