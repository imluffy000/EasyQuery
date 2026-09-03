/**
 * Chart rendering.
 *
 * The backend sends a declarative spec (type + field names) chosen from result
 * shape. This component maps that spec onto Recharts; it never evaluates
 * anything the model produced.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatCompact, formatNumber } from '@/lib/utils'
import type { QueryResult, Visualization } from '@/types/api'

/**
 * Categorical palette. Ordered so adjacent series stay distinguishable, and
 * chosen to hold contrast against both the light and dark surface tokens.
 */
const SERIES = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899']

const AXIS = {
  stroke: 'rgb(var(--subtle))',
  fontSize: 11,
  fontFamily: '"JetBrains Mono", monospace',
}

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
    <div className="rounded border border-border bg-surface px-2.5 py-1.5 shadow-popover">
      {label !== undefined && (
        <p className="mb-1 font-mono text-2xs text-muted">{String(label)}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5 font-mono text-xs text-fg">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ background: entry.color }}
            aria-hidden
          />
          {entry.name}: {typeof entry.value === 'number' ? formatNumber(entry.value) : String(entry.value)}
        </p>
      ))}
    </div>
  )
}

export function KpiTile({ value, title }: { value: unknown; title: string }) {
  const display =
    typeof value === 'number' ? formatNumber(value) : value === null ? '—' : String(value)
  return (
    <div className="panel px-5 py-4">
      <p className="text-2xs uppercase tracking-wide text-subtle">{title || 'Result'}</p>
      <p className="mt-1 font-mono text-3xl tabular-nums text-fg">{display}</p>
    </div>
  )
}

export function ChartView({
  spec,
  result,
  height = 260,
}: {
  spec: Visualization
  result: QueryResult
  height?: number
}) {
  const { type, x, y, title } = spec

  if (type === 'kpi') {
    const column = y ?? result.columns[0]
    return <KpiTile value={column ? result.rows[0]?.[column] : null} title={title} />
  }

  if (type === 'table' || !x || !y) return null

  const data = result.rows.map((row) => ({
    ...row,
    [x]: row[x] === null || row[x] === undefined ? '—' : row[x],
  }))

  const common = (
    <>
      <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey={x} tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--border))' }} />
      <YAxis
        tick={AXIS}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v) => formatCompact(Number(v))}
        width={52}
      />
      <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgb(var(--elevated))' }} />
    </>
  )

  return (
    <figure className="panel p-3">
      {title && <figcaption className="mb-2 text-xs font-medium text-fg">{title}</figcaption>}
      <ResponsiveContainer width="100%" height={height}>
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {common}
            <Line
              type="monotone"
              dataKey={y}
              stroke={SERIES[0]}
              strokeWidth={2}
              dot={data.length <= 30}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {common}
            <Area
              type="monotone"
              dataKey={y}
              stroke={SERIES[0]}
              fill={SERIES[0]}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Tooltip content={<TooltipBox />} />
            <Pie data={data} dataKey={y} nameKey={x} outerRadius="75%" innerRadius="45%">
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : type === 'scatter' ? (
          <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {common}
            <Scatter data={data} dataKey={y} fill={SERIES[0]} />
          </ScatterChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {common}
            <Bar dataKey={y} fill={SERIES[0]} radius={[2, 2, 0, 0]} maxBarSize={44} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  )
}
