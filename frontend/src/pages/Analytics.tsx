/**
 * Workspace analytics.
 *
 * Two charts sit on this page and both are read by people who cannot see
 * colour, so each carries an accessible name, labelled axes and a legend —
 * the mark colour is never the only thing carrying meaning.
 *
 * Series colour comes from the --series-* tokens resolved at paint time, the
 * same approach ChartView uses: Recharts writes SVG fill/stroke attributes and
 * cannot resolve `rgb(var(--x))`, so the values are read off the document once
 * per theme instead of being hardcoded to a single palette.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

const SERIES_COUNT = 7

/** Resolve the --series-* tokens for the theme currently on <html>. */
function useSeriesColors(): string[] {
  const read = () => {
    if (typeof window === 'undefined') return []
    const style = getComputedStyle(document.documentElement)
    return Array.from({ length: SERIES_COUNT }, (_, i) => {
      const raw = style.getPropertyValue(`--series-${i + 1}`).trim()
      return raw ? `rgb(${raw})` : 'currentColor'
    })
  }

  const [colors, setColors] = useState<string[]>(read)

  useEffect(() => {
    const update = () => setColors(read())
    update()
    // The theme is a class on <html>; re-read whenever it changes.
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  return colors
}

const AXIS = {
  fill: 'rgb(var(--subtle))',
  fontSize: 11,
  fontFamily: '"Fira Code", monospace',
}

const AXIS_LABEL = { fill: 'rgb(var(--subtle))', fontSize: 10 }

const LEGEND_STYLE = { fontSize: 11, fontFamily: '"Fira Code", monospace' }

const RANGES = [
  { value: 1, label: 'Last 24 hours', phrase: 'the last 24 hours' },
  { value: 7, label: 'Last 7 days', phrase: 'the last 7 days' },
  { value: 30, label: 'Last 30 days', phrase: 'the last 30 days' },
  { value: 90, label: 'Last 90 days', phrase: 'the last 90 days' },
]

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name?: string; value?: unknown; color?: string }[]
  label?: unknown
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-border-strong bg-surface px-2.5 py-1.5 shadow-popover">
      {label !== undefined && <p className="mb-1 font-mono text-2xs text-muted">{String(label)}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-fg">
          <span className="h-2 w-2 shrink-0" style={{ background: entry.color }} aria-hidden />
          {entry.name}:{' '}
          {typeof entry.value === 'number' ? formatNumber(entry.value) : String(entry.value)}
        </p>
      ))}
    </div>
  )
}

export function AnalyticsPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const [days, setDays] = useState(7)
  const series = useSeriesColors()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics', workspaceId, days],
    queryFn: () => api.analytics(workspaceId!, days),
    enabled: Boolean(workspaceId),
  })

  const rangePhrase = RANGES.find((r) => r.value === days)?.phrase ?? `the last ${days} days`

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-40" />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="p-5">
        <div className="mx-auto max-w-5xl">
          <ErrorState message="Could not load analytics." onRetry={() => void refetch()} />
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="p-5">
        <div className="panel mx-auto max-w-2xl">
          <EmptyState
            title="No analytics available"
            description="Once queries are recorded in this workspace, their volume, latency and outcomes appear here."
          />
        </div>
      </div>
    )
  }

  const s = data.summary

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-3">
          <div>
            <p className="micro">Workspace</p>
            <h1 className="mt-0.5 text-xl font-medium text-fg">Analytics</h1>
            <p className="mt-0.5 text-xs text-muted">
              Measured from recorded queries. These are actuals, not targets.
            </p>
          </div>
          <div className="w-36 shrink-0">
            <Select
              aria-label="Time range"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 py-0"
            >
              {RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </Select>
          </div>
        </header>

        <section aria-labelledby="analytics-summary" className="mb-3">
          <h2 id="analytics-summary" className="micro mb-1.5">
            Summary
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Query volume">
            {data.query_volume.length === 0 ? (
              <EmptyState
                title="No queries in this period"
                description="Widen the time range, or ask a question in Chat."
              />
            ) : (
              <div
                role="img"
                aria-label={`Line chart: number of queries run over ${rangePhrase}, by time bucket.`}
                className="p-3"
              >
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart
                    data={data.query_volume}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid
                      stroke="rgb(var(--border))"
                      strokeDasharray="2 4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="bucket"
                      tick={AXIS}
                      tickLine={false}
                      axisLine={{ stroke: 'rgb(var(--border-strong))' }}
                      height={38}
                      label={{
                        value: 'Time bucket',
                        position: 'insideBottom',
                        offset: -2,
                        ...AXIS_LABEL,
                      }}
                    />
                    <YAxis
                      tick={AXIS}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatCompact(Number(v))}
                      width={52}
                      label={{
                        value: 'Queries',
                        angle: -90,
                        position: 'insideLeft',
                        ...AXIS_LABEL,
                      }}
                    />
                    <Tooltip content={<TooltipBox />} cursor={{ stroke: 'rgb(var(--border-strong))' }} />
                    <Legend verticalAlign="top" height={22} wrapperStyle={LEGEND_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="Queries"
                      stroke={series[0] ?? 'currentColor'}
                      strokeWidth={2}
                      dot={data.query_volume.length <= 30}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="Latency distribution">
            {data.latency_distribution.length === 0 ? (
              <EmptyState
                title="No completed queries yet"
                description="Latency is recorded once a query finishes executing."
              />
            ) : (
              <div
                role="img"
                aria-label={`Bar chart: how many queries fell into each execution-latency bucket over ${rangePhrase}.`}
                className="p-3"
              >
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart
                    data={data.latency_distribution}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid
                      stroke="rgb(var(--border))"
                      strokeDasharray="2 4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="bucket"
                      tick={AXIS}
                      tickLine={false}
                      axisLine={{ stroke: 'rgb(var(--border-strong))' }}
                      height={38}
                      label={{
                        value: 'Latency bucket',
                        position: 'insideBottom',
                        offset: -2,
                        ...AXIS_LABEL,
                      }}
                    />
                    <YAxis
                      tick={AXIS}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatCompact(Number(v))}
                      width={52}
                      label={{
                        value: 'Queries',
                        angle: -90,
                        position: 'insideLeft',
                        ...AXIS_LABEL,
                      }}
                    />
                    <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgb(var(--elevated))' }} />
                    <Legend verticalAlign="top" height={22} wrapperStyle={LEGEND_STYLE} />
                    <Bar
                      dataKey="value"
                      name="Queries"
                      fill={series[1] ?? 'currentColor'}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="Status breakdown">
            {Object.keys(data.status_breakdown).length === 0 ? (
              <EmptyState title="No outcomes recorded" />
            ) : (
              <table className="w-full">
                <caption className="sr-only">Query outcomes by status</caption>
                <thead>
                  <tr>
                    <th scope="col" className="micro px-3 py-1.5 text-left">
                      Status
                    </th>
                    <th scope="col" className="micro px-3 py-1.5 text-right">
                      Queries
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Object.entries(data.status_breakdown).map(([status, count]) => (
                    <tr key={status}>
                      <td className="px-3 py-1.5 text-xs text-muted">{status.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-fg">
                        {formatNumber(count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Most queried tables">
            {data.top_tables.length === 0 ? (
              <EmptyState title="No table usage recorded" />
            ) : (
              <table className="w-full">
                <caption className="sr-only">Most queried tables</caption>
                <thead>
                  <tr>
                    <th scope="col" className="micro px-3 py-1.5 text-left">
                      Table
                    </th>
                    <th scope="col" className="micro px-3 py-1.5 text-right">
                      Queries
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.top_tables.map((row) => (
                    <tr key={row.table}>
                      <td className="truncate px-3 py-1.5 font-mono text-xs text-fg">{row.table}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted">
                        {formatCompact(row.count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
