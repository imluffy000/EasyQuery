/**
 * Chart rendering.
 *
 * The backend sends a declarative spec (type + field names) chosen from result
 * shape. This component maps that spec onto Recharts; it never evaluates
 * anything the model produced.
 *
 * Colour comes from the --series-* tokens, resolved at paint time. Recharts
 * writes SVG `fill`/`stroke` attributes and cannot resolve `rgb(var(--x))`,
 * so the values are read off the document once per theme rather than being
 * hardcoded — which is what previously pinned every chart to the dark-mode
 * accent even in light mode.
 *
 * Colour is never the only channel: every multi-series chart also carries a
 * legend, and the pie labels its slices directly. Seven categorical hues
 * cannot be made robustly distinguishable under all colour-vision
 * deficiencies, so the redundant encoding is load-bearing, not decoration.
 */

import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

export function KpiTile({ value, title }: { value: unknown; title: string }) {
  const display =
    typeof value === 'number' ? formatNumber(value) : value === null ? '—' : String(value)
  return (
    <div className="panel px-5 py-4">
      <p className="micro">{title || 'Result'}</p>
      <p className="mt-1.5 font-mono text-3xl tabular-nums text-fg">{display}</p>
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
  const series = useSeriesColors()
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

  const caption = title || `${y} by ${x}`
  const primary = series[0] ?? 'currentColor'

  const common = (
    <>
      <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="2 4" vertical={false} />
      <XAxis
        dataKey={x}
        tick={AXIS}
        tickLine={false}
        axisLine={{ stroke: 'rgb(var(--border-strong))' }}
        label={{ value: x, position: 'insideBottom', offset: -2, fill: 'rgb(var(--subtle))', fontSize: 10 }}
        height={38}
      />
      <YAxis
        tick={AXIS}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v) => formatCompact(Number(v))}
        width={58}
        label={{ value: y, angle: -90, position: 'insideLeft', fill: 'rgb(var(--subtle))', fontSize: 10 }}
      />
      <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgb(var(--elevated))' }} />
    </>
  )

  return (
    <figure className="panel p-3">
      <figcaption className="micro mb-2 text-muted">{caption}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            {common}
            <Line
              type="monotone"
              dataKey={y}
              name={y}
              stroke={primary}
              strokeWidth={2}
              dot={data.length <= 30}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            {common}
            <Area
              type="monotone"
              dataKey={y}
              name={y}
              stroke={primary}
              fill={primary}
              fillOpacity={0.16}
              strokeWidth={2}
            />
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <Tooltip content={<TooltipBox />} />
            <Legend
              verticalAlign="bottom"
              height={28}
              wrapperStyle={{ fontSize: 11, fontFamily: '"Fira Code", monospace' }}
            />
            <Pie
              data={data}
              dataKey={y}
              nameKey={x}
              outerRadius="70%"
              innerRadius="42%"
              // Slice identity must not require hovering one slice at a time.
              label={data.length <= 8 ? ({ name }) => String(name) : false}
              labelLine={data.length <= 8}
              stroke="rgb(var(--surface))"
              strokeWidth={1}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={series[i % SERIES_COUNT] ?? primary} />
              ))}
            </Pie>
          </PieChart>
        ) : type === 'scatter' ? (
          // Points are positioned by the axes, not by Scatter's dataKey, so
          // the Y axis must bind to the measure or every point collapses.
          <ScatterChart margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="2 4" />
            <XAxis
              type="category"
              dataKey={x}
              name={x}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: 'rgb(var(--border-strong))' }}
              height={38}
              label={{ value: x, position: 'insideBottom', offset: -2, fill: 'rgb(var(--subtle))', fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey={y}
              name={y}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatCompact(Number(v))}
              width={58}
              label={{ value: y, angle: -90, position: 'insideLeft', fill: 'rgb(var(--subtle))', fontSize: 10 }}
            />
            <Tooltip content={<TooltipBox />} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={data} name={y} fill={primary} />
          </ScatterChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            {common}
            <Bar dataKey={y} name={y} fill={primary} maxBarSize={44} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  )
}
