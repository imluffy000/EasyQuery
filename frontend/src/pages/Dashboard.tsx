/**
 * Workspace overview.
 *
 * The three queries behind this page are independent, so their failures are
 * reported independently. A metric whose request failed renders an em-dash and
 * an error with a retry — never `?? 0`, which would present a dead API as a
 * measured zero.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Database, MessageSquare, Plug, Table2 } from 'lucide-react'

import { statusTone } from '@/components/layout/DatabaseSelector'
import { Reveal, Stagger, StaggerItem } from '@/components/motion'
import {
  AsyncBoundary,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  Stat,
  StatusDot,
} from '@/components/ui'
import { api } from '@/lib/api'
import { formatDuration, formatNumber, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

export function DashboardPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)

  const {
    data: databases = [],
    isLoading: loadingDatabases,
    isError: databasesError,
    refetch: refetchDatabases,
  } = useQuery({
    queryKey: ['databases', workspaceId],
    queryFn: () => api.databases.list(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const {
    data: history = [],
    isLoading: loadingHistory,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['history', workspaceId, 'dashboard'],
    queryFn: () => api.queries.history(workspaceId!, { limit: '8' }),
    enabled: Boolean(workspaceId),
  })

  const {
    data: analytics,
    isLoading: loadingAnalytics,
    isError: analyticsError,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: ['analytics', workspaceId, 7],
    queryFn: () => api.analytics(workspaceId!, 7),
    enabled: Boolean(workspaceId),
  })

  if (loadingDatabases) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-40" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (databasesError) {
    return (
      <div className="p-5">
        <div className="mx-auto max-w-2xl">
          <ErrorState
            message="Could not load this workspace's databases."
            onRetry={() => void refetchDatabases()}
          />
        </div>
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

  /**
   * A measured figure, or an honest placeholder. Loading shows a skeleton;
   * a failed or absent fetch shows an em-dash. Neither is ever a zero.
   */
  const metric = (render: (summary: NonNullable<typeof s>) => ReactNode): ReactNode => {
    if (loadingAnalytics) return <Skeleton className="h-7 w-20" />
    if (!s) return '—'
    // The figure replaces its skeleton with a fade, so the tile does not
    // blink from grey block to number.
    return (
      <Reveal as="span" variant="fade">
        {render(s)}
      </Reveal>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl">
        <Reveal
          as="header"
          className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-3"
        >
          <div>
            <p className="micro">Workspace</p>
            <h1 className="mt-0.5 text-xl font-medium text-fg">Dashboard</h1>
            <p className="mt-0.5 text-xs text-muted">Last 7 days</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link to="/chat">
              <Button variant="primary" className="group">
                <MessageSquare
                  className="h-3.5 w-3.5 transition-transform duration-base motion-safe:group-hover:-translate-y-px"
                  aria-hidden
                />{' '}
                Ask a question
              </Button>
            </Link>
            <Link to="/schema">
              <Button variant="secondary">
                <Table2 className="h-3.5 w-3.5" aria-hidden /> Explore schema
              </Button>
            </Link>
          </div>
        </Reveal>

        <section aria-labelledby="dashboard-metrics" className="mb-3">
          <h2 id="dashboard-metrics" className="micro mb-1.5">
            Activity
          </h2>

          {analyticsError && (
            <div className="mb-2">
              <ErrorState
                message="Could not load workspace metrics. The figures below are unavailable, not zero."
                onRetry={() => void refetchAnalytics()}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat index={1} label="Connected databases" value={formatNumber(databases.length)} />
            <Stat
              index={2}
              label="Queries today"
              value={metric((summary) => formatNumber(summary.queries_today))}
            />
            <Stat
              index={3}
              label="Success rate"
              value={metric((summary) => `${summary.success_rate}%`)}
              tone={s ? (s.success_rate < 90 ? 'warn' : 'ok') : undefined}
            />
            <Stat
              index={4}
              label="Avg latency"
              value={metric((summary) => formatDuration(summary.avg_latency_ms))}
            />
          </div>
        </section>

        {/* Metrics first, then the panels that explain them. */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel index={5} title="Databases">
            <Stagger as="ul" className="divide-y divide-border">
              {databases.map((db, i) => (
                <StaggerItem
                  as="li"
                  key={db.id}
                  index={i + 5}
                  variant="fade"
                  className="flex items-center gap-2.5 px-3 py-2"
                >
                  <StatusDot tone={statusTone(db.status)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg">{db.name}</p>
                    <p className="truncate font-mono text-2xs text-subtle">
                      {db.engine} · {db.database_name}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle">
                    {db.last_synced_at ? formatRelative(db.last_synced_at) : 'not synced'}
                  </span>
                  {db.read_only && <Badge tone="ok">read-only</Badge>}
                </StaggerItem>
              ))}
            </Stagger>
          </Panel>

          <Panel
            index={6}
            title="Recent queries"
            actions={
              <Link
                to="/history"
                className="group inline-flex items-center gap-1 border border-transparent px-1 py-px text-2xs uppercase tracking-[0.08em] text-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                View all
                <ArrowRight
                  className="h-3 w-3 transition-transform duration-base motion-safe:group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            }
          >
            <AsyncBoundary
              isLoading={loadingHistory}
              isError={historyError}
              isEmpty={history.length === 0}
              onRetry={() => void refetchHistory()}
              errorMessage="Could not load recent queries."
              skeleton={
                <div className="divide-y divide-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-3 py-2.5">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="mt-1.5 h-2.5 w-24" />
                    </div>
                  ))}
                </div>
              }
              empty={
                <EmptyState title="No queries yet" description="Ask a question to get started." />
              }
            >
              <Stagger as="ul" className="divide-y divide-border">
                {history.map((q, i) => (
                  <StaggerItem
                    as="li"
                    key={q.id}
                    index={i + 6}
                    variant="fade"
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-fg">{q.question}</p>
                      <p className="font-mono text-2xs tabular-nums text-subtle">
                        {formatRelative(q.created_at)}
                        {q.duration_ms != null && ` · ${formatDuration(q.duration_ms)}`}
                      </p>
                    </div>
                    <Badge tone={q.status === 'success' ? 'ok' : q.was_blocked ? 'danger' : 'neutral'}>
                      {q.status}
                    </Badge>
                  </StaggerItem>
                ))}
              </Stagger>
            </AsyncBoundary>
          </Panel>
        </div>
      </div>
    </div>
  )
}
