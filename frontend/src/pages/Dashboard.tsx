import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Database, MessageSquare, Plug, Table2 } from 'lucide-react'

import { statusTone } from '@/components/layout/DatabaseSelector'
import { Badge, Button, EmptyState, Panel, Skeleton, Stat, StatusDot } from '@/components/ui'
import { api } from '@/lib/api'
import { formatDuration, formatNumber, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

export function DashboardPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)

  const { data: databases = [], isLoading: loadingDatabases } = useQuery({
    queryKey: ['databases', workspaceId],
    queryFn: () => api.databases.list(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const { data: history = [] } = useQuery({
    queryKey: ['history', workspaceId, 'dashboard'],
    queryFn: () => api.queries.history(workspaceId!, { limit: '8' }),
    enabled: Boolean(workspaceId),
  })

  const { data: analytics } = useQuery({
    queryKey: ['analytics', workspaceId, 7],
    queryFn: () => api.analytics(workspaceId!, 7),
    enabled: Boolean(workspaceId),
  })

  if (loadingDatabases) {
    return (
      <div className="grid grid-cols-4 gap-3 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }

  if (databases.length === 0) {
    return (
      <div className="p-5">
        <div className="panel mx-auto max-w-2xl">
          <EmptyState
            icon={<Database className="h-7 w-7" />}
            title="No databases connected"
            description="Connect your PostgreSQL or Supabase database to start asking questions about your data."
            action={
              <Link to="/databases">
                <Button variant="primary">
                  <Plug className="h-3.5 w-3.5" aria-hidden /> Connect database
                </Button>
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  const s = analytics?.summary

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium">Dashboard</h1>
            <p className="text-xs text-muted">Last 7 days</p>
          </div>
          <div className="flex gap-2">
            <Link to="/chat">
              <Button variant="primary">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Ask a question
              </Button>
            </Link>
            <Link to="/schema">
              <Button variant="secondary">
                <Table2 className="h-3.5 w-3.5" aria-hidden /> Explore schema
              </Button>
            </Link>
          </div>
        </header>

        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Connected databases" value={databases.length} />
          <Stat label="Queries today" value={formatNumber(s?.queries_today ?? 0)} />
          <Stat
            label="Success rate"
            value={s ? `${s.success_rate}%` : '—'}
            tone={s && s.success_rate < 90 ? 'warn' : 'ok'}
          />
          <Stat label="Avg latency" value={formatDuration(s?.avg_latency_ms ?? null)} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Databases">
            <ul className="divide-y divide-border">
              {databases.map((db) => (
                <li key={db.id} className="flex items-center gap-2.5 px-3 py-2">
                  <StatusDot tone={statusTone(db.status)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg">{db.name}</p>
                    <p className="truncate font-mono text-2xs text-subtle">
                      {db.engine} · {db.database_name}
                    </p>
                  </div>
                  <span className="shrink-0 text-2xs text-subtle">
                    {db.last_synced_at ? formatRelative(db.last_synced_at) : 'not synced'}
                  </span>
                  {db.read_only && <Badge tone="ok">read-only</Badge>}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Recent queries"
            actions={
              <Link to="/history" className="text-2xs text-muted hover:text-fg">
                View all
              </Link>
            }
          >
            {history.length === 0 ? (
              <EmptyState title="No queries yet" description="Ask a question to get started." />
            ) : (
              <ul className="divide-y divide-border">
                {history.map((q) => (
                  <li key={q.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-fg">{q.question}</p>
                      <p className="font-mono text-2xs text-subtle">
                        {formatRelative(q.created_at)}
                        {q.duration_ms != null && ` · ${formatDuration(q.duration_ms)}`}
                      </p>
                    </div>
                    <Badge
                      tone={
                        q.status === 'success' ? 'ok' : q.was_blocked ? 'danger' : 'neutral'
                      }
                    >
                      {q.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
