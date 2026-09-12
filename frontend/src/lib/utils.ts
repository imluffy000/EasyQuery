import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

const NUMBER = new Intl.NumberFormat('en-US')

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return NUMBER.format(value)
}

/** Compact form for dense table cells and stat tiles: 18,421 -> 18.4K */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (Math.abs(value) < 1000) return NUMBER.format(value)
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const seconds = Math.round((Date.now() - then) / 1000)

  if (seconds < 45) return 'just now'
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ]
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  let previous = 1
  for (const [limit, unit] of units) {
    if (seconds < limit) return rtf.format(-Math.round(seconds / previous), unit)
    previous = limit
  }
  return rtf.format(-Math.round(seconds / 31557600), 'year')
}

/**
 * Render a database value for a table cell without throwing on odd types.
 *
 * Numbers are NOT passed through Intl.NumberFormat here. Its defaults round
 * to three fraction digits and add grouping, which silently rewrites the
 * data: 0.00004 renders as "0" and a year 2024 renders as "2,024". A cell in
 * a SQL result must show what the database returned. `formatNumber` stays
 * available for stat tiles, where rounding is wanted.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function isNullish(value: unknown): boolean {
  return value === null || value === undefined
}

/** Groups history rows under Today / Yesterday / a date. */
export function dayBucket(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

/**
 * Does this statement look like it writes?
 *
 * Used only to decide whether to ask for confirmation. The authority on what
 * may actually run is the server's SQL guard, which parses the statement into
 * an AST -- a keyword scan is the wrong place to enforce anything, and this
 * one is deliberately for warning only. Comments and string literals are
 * stripped first so a commented-out DROP, or the word 'delete' stored in a
 * column, does not trip it.
 */
const DESTRUCTIVE_SQL =
  /\b(delete|drop|truncate|update|insert|alter|grant|revoke|replace|merge|upsert)\b/i

export function isDestructiveSql(sql: string): boolean {
  const bare = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, " '' ")
  return DESTRUCTIVE_SQL.test(bare)
}
