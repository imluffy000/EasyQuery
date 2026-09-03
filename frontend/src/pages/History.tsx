import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ShieldAlert } from 'lucide-react'

import { SqlViewer } from '@/components/chat/SqlPanel'
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

  const { data = [], isLoading, error, refetch } = useQuery({
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
    return [...buckets.entries()]
  }, [data])

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4">
          <h1 className="text-lg font-medium">Query history</h1>
          <p className="text-xs text-muted">Every question asked in this workspace.</p>
        </header>

        <div className="mb-3 flex gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 rounded border border-border bg-surface px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions"
              aria-label="Search query history"
              className="w-full bg-transparent text-xs text-fg placeholder:text-subtle focus:outline-none"
            />
          </div>
          <div className="w-40">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 py-0">
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="blocked">Blocked</option>
              <option value="needs_clarification">Needs clarification</option>
            </Select>
          </div>
        </div>

        {error && <ErrorState message="Could not load history." onRetry={() => void refetch()} />}

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!isLoading && data.length === 0 && !error && (
          <div className="panel">
            <EmptyState
              title="No queries yet"
              description="Questions you ask in Chat will appear here with their SQL and execution details."
            />
          </div>
        )}

        {grouped.map(([bucket, records]) => (
          <section key={bucket} className="mb-4">
            <h2 className="mb-1.5 text-2xs uppercase tracking-wide text-subtle">{bucket}</h2>
            <ul className="space-y-1.5">
              {records.map((record) => (
                <li key={record.id}>
                  <div className="panel overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === record.id ? null : record.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left cursor-pointer
                                 transition-colors hover:bg-elevated/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-fg">{record.question}</p>
                        <p className="font-mono text-2xs text-subtle">
                          {formatRelative(record.created_at)}
                          {record.duration_ms != null && ` · ${formatDuration(record.duration_ms)}`}
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

                    {expanded === record.id && (
                      <div className={cn('border-t border-border')}>
                        {record.error_message && (
                          <p className="border-b border-border px-3 py-2 text-2xs text-danger">
                            {record.error_code}: {record.error_message}
                          </p>
                        )}
                        {record.assumptions.length > 0 && (
                          <ul className="border-b border-border px-3 py-2">
                            {record.assumptions.map((a, i) => (
                              <li key={i} className="text-2xs text-muted">
                                Assumed: {a}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(record.executed_sql || record.generated_sql) && (
                          <SqlViewer
                            sql={record.executed_sql ?? record.generated_sql ?? ''}
                            height={140}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
