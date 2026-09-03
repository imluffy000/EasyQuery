import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState, ErrorState, Panel, Select, Skeleton, Stat } from '@/components/ui'
import { api } from '@/lib/api'
import { formatCompact, formatDuration, formatNumber } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

const AXIS = {
  stroke: 'rgb(var(--subtle))',
  fontSize: 11,
  fontFamily: '"JetBrains Mono", monospace',
}

export function AnalyticsPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const [days, setDays] = useState(7)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics', workspaceId, days],
    queryFn: () => api.analytics(workspaceId!, days),
    enabled: Boolean(workspaceId),
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-3 p-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-5">
        <ErrorState message="Could not load analytics." onRetry={() => void refetch()} />
      </div>
    )
  }
  if (!data) return <EmptyState title="No analytics available" />

  const s = data.summary

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium">Analytics</h1>
            <p className="text-xs text-muted">
              Measured from recorded queries. These are actuals, not targets.
            </p>
          </div>
          <div className="w-32">
            <Select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 py-0"
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
          </div>
        </header>

        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Queries today" value={formatNumber(s.queries_today)} />
          <Stat
            label="Success rate"
            value={`${s.success_rate}%`}
            tone={s.success_rate >= 95 ? 'ok' : s.success_rate >= 80 ? 'warn' : 'danger'}
          />
          <Stat label="Avg latency" value={formatDuration(s.avg_latency_ms)} />
          <Stat label="P95 latency" value={formatDuration(s.p95_latency_ms)} />
          <Stat
            label="Clarification rate"
            value={`${s.clarification_rate}%`}
            sub="Questions the agent asked about"
          />
          <Stat
            label="Correction rate"
            value={`${s.correction_rate}%`}
            sub="Queries needing SQL regeneration"
          />
          <Stat label="Model spend" value={`$${s.llm_cost_usd.toFixed(4)}`} />
          <Stat
            label="Blocked / timeouts"
            value={`${s.blocked_count} / ${s.timeout_count}`}
            tone={s.blocked_count > 0 ? 'warn' : undefined}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Query volume" className="p-3">
            {data.query_volume.length === 0 ? (
              <EmptyState title="No queries in this period" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.query_volume} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="bucket" tick={AXIS} tickLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgb(var(--surface))',
                      border: '1px solid rgb(var(--border))',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Latency distribution" className="p-3">
            {data.latency_distribution.length === 0 ? (
              <EmptyState title="No completed queries yet" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.latency_distribution}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="bucket" tick={AXIS} tickLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    cursor={{ fill: 'rgb(var(--elevated))' }}
                    contentStyle={{
                      background: 'rgb(var(--surface))',
                      border: '1px solid rgb(var(--border))',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Status breakdown">
            <ul className="divide-y divide-border">
              {Object.entries(data.status_breakdown).map(([status, count]) => (
                <li key={status} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-muted">{status.replace(/_/g, ' ')}</span>
                  <span className="font-mono tabular-nums text-fg">{formatNumber(count)}</span>
                </li>
              ))}
              {Object.keys(data.status_breakdown).length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-subtle">No data</li>
              )}
            </ul>
          </Panel>

          <Panel title="Most queried tables">
            <ul className="divide-y divide-border">
              {data.top_tables.map((row) => (
                <li key={row.table} className="flex items-center justify-between px-3 py-1.5">
                  <span className="truncate font-mono text-xs text-fg">{row.table}</span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {formatCompact(row.count)}
                  </span>
                </li>
              ))}
              {data.top_tables.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-subtle">No data</li>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
