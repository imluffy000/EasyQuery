/**
 * Result table.
 *
 * Rows are virtualized: a 10,000-row result must not put 10,000 <tr> nodes in
 * the DOM. Because only a window of rows exists, the table must state its
 * real size through aria-rowcount/aria-rowindex — otherwise a screen reader
 * reports "14 rows" for a 10,000-row result.
 *
 * Column widths are resizable because generated queries return columns we
 * cannot anticipate, which also makes resizing the primary way to read a
 * truncated cell — so it carries a keyboard path, not just a drag handle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Check, Download, Maximize2, Minimize2, Search } from 'lucide-react'

import { PopIn } from '@/components/motion'
import { Badge, Button } from '@/components/ui'
import { cn, formatCell, formatDuration, formatNumber } from '@/lib/utils'
import type { QueryResult } from '@/types/api'

const ROW_HEIGHT = 28
const MIN_WIDTH = 90
const DEFAULT_WIDTH = 150

/**
 * Only the rows visible when a result first lands fade in, top to bottom.
 * Rows are virtualized and remount as the table scrolls, so an animation tied
 * to mounting would replay on every scroll; the intro is tied to the first
 * paint of this result instead, and ends for good after INTRO_MS.
 */
const INTRO_ROWS = 12
const INTRO_STEP_MS = 22
const INTRO_MS = 700

interface Props {
  result: QueryResult
  className?: string
}

export function ResultTable({ result, className }: Props) {
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null)
  const [filter, setFilter] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fullscreenToggleRef = useRef<HTMLButtonElement>(null)
  const [intro, setIntro] = useState(true)

  // Each result gets its own table instance, so the intro belongs to mount.
  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const rows = useMemo(() => {
    let out = result.rows
    const q = filter.trim().toLowerCase()
    if (q) {
      out = out.filter((row) =>
        result.columns.some((c) => formatCell(row[c]).toLowerCase().includes(q)),
      )
    }
    if (sort) {
      const { column, dir } = sort
      out = [...out].sort((a, b) => {
        const av = a[column]
        const bv = b[column]
        if (av === bv) return 0
        // Nulls always sort last, regardless of direction.
        if (av === null || av === undefined) return 1
        if (bv === null || bv === undefined) return -1
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : formatCell(av).localeCompare(formatCell(bv), undefined, { numeric: true })
        return dir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [result.rows, result.columns, filter, sort])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // Fullscreen is a full-viewport overlay; Escape must leave it and focus
  // must return to the control that opened it.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreen(false)
        fullscreenToggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const copyCell = useCallback((key: string, text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200)
  }, [])

  const exportCsv = () => {
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    // The on-screen caveats must travel with the file. A CSV that drops
    // "truncated" or "filtered" is a file that misrepresents the query.
    const notes: string[] = []
    if (result.truncated) notes.push(`row cap reached at ${result.row_count} rows`)
    if (filter.trim()) notes.push(`filtered by "${filter.trim()}"`)
    const header = notes.length ? [`# incomplete export: ${notes.join('; ')}`] : []

    const csv = [
      ...header,
      result.columns.join(','),
      ...rows.map((r) => result.columns.map((c) => escape(r[c])).join(',')),
    ].join('\n')

    const suffix = [result.truncated ? 'truncated' : '', filter.trim() ? 'filtered' : '']
      .filter(Boolean)
      .join('-')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `query-result-${Date.now()}${suffix ? `-${suffix}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const resizeBy = (column: string, delta: number) =>
    setWidths((w) => ({
      ...w,
      [column]: Math.max(MIN_WIDTH, (w[column] ?? DEFAULT_WIDTH) + delta),
    }))

  const startResize = (column: string, startX: number, startWidth: number) => {
    const onMove = (e: MouseEvent) =>
      setWidths((w) => ({ ...w, [column]: Math.max(MIN_WIDTH, startWidth + e.clientX - startX) }))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const items = virtualizer.getVirtualItems()
  const trailing =
    virtualizer.getTotalSize() - (items.length ? (items[items.length - 1]?.end ?? 0) : 0)

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden border border-border bg-surface',
        fullscreen && 'fixed inset-3 z-50 shadow-popover',
        className,
      )}
    >
      {/* Wraps, so a narrow viewport stacks the controls instead of clipping them. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-elevated px-2.5 py-1.5">
        <span className="readout">
          <span className="text-fg">{formatNumber(rows.length)}</span>
          {rows.length !== result.row_count && ` / ${formatNumber(result.row_count)}`} rows
        </span>
        <span className="readout">{formatDuration(result.duration_ms)}</span>
        {result.truncated && <Badge tone="warn">may be incomplete</Badge>}

        <div className="flex-1" />

        <div className="flex h-6 items-center gap-1.5 border border-border-control bg-surface px-1.5">
          <Search className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows"
            aria-label="Filter rows"
            className="w-24 bg-transparent text-2xs text-fg placeholder:text-subtle focus:outline-none"
          />
        </div>
        <Button size="sm" variant="ghost" onClick={exportCsv} title="Export CSV" aria-label="Export CSV">
          <Download className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          ref={fullscreenToggleRef}
          size="sm"
          variant="ghost"
          onClick={() => setFullscreen((v) => !v)}
          aria-pressed={fullscreen}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className="data-table"
          aria-label={`Query result, ${formatNumber(rows.length)} rows, ${result.columns.length} columns`}
          aria-rowcount={rows.length + 1}
          style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}
        >
          <thead>
            <tr aria-rowindex={1}>
              {result.columns.map((column) => {
                const active = sort?.column === column
                return (
                  <th
                    key={column}
                    style={{ width: widths[column] ?? DEFAULT_WIDTH }}
                    aria-sort={
                      active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    className="group relative select-none"
                  >
                    <button
                      onClick={() =>
                        setSort((s) =>
                          s?.column === column && s.dir === 'asc'
                            ? { column, dir: 'desc' }
                            : s?.column === column && s.dir === 'desc'
                              ? null
                              : { column, dir: 'asc' },
                        )
                      }
                      className="flex w-full cursor-pointer items-center gap-1 text-left hover:text-fg"
                    >
                      <span className="truncate">{column}</span>
                      {active &&
                        (sort.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0 text-accent" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0 text-accent" aria-hidden />
                        ))}
                    </button>
                    {/* Focusable, with arrow keys — resizing is how you read a
                        truncated cell, so it cannot be mouse-only. */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      tabIndex={0}
                      aria-label={`Resize column ${column}`}
                      aria-valuenow={widths[column] ?? DEFAULT_WIDTH}
                      aria-valuemin={MIN_WIDTH}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                        e.preventDefault()
                        resizeBy(column, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 40 : 10))
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        startResize(column, e.clientX, widths[column] ?? DEFAULT_WIDTH)
                      }}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize
                                 bg-transparent hover:bg-accent/50 focus-visible:bg-accent"
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {items.length > 0 && items[0] && (
              <tr aria-hidden>
                <td colSpan={result.columns.length} style={{ height: items[0].start, padding: 0, border: 0 }} />
              </tr>
            )}
            {items.map((item) => {
              const row = rows[item.index]
              if (!row) return null
              const introRow = intro && item.index < INTRO_ROWS
              return (
                <tr
                  key={item.key}
                  aria-rowindex={item.index + 2}
                  className={introRow ? 'animate-row-in' : undefined}
                  style={{
                    height: ROW_HEIGHT,
                    animationDelay: introRow ? `${item.index * INTRO_STEP_MS}ms` : undefined,
                  }}
                >
                  {result.columns.map((column) => {
                    const value = row[column]
                    const isNull = value === null || value === undefined
                    const text = formatCell(value)
                    const key = `${item.index}:${column}`
                    const isCopied = copied === key
                    return (
                      <td
                        key={column}
                        style={{ width: widths[column] ?? DEFAULT_WIDTH }}
                        className={cn(
                          'overflow-hidden p-0',
                          typeof value === 'number' && 'text-right tabular-nums',
                        )}
                      >
                        {/* A real control: reachable by keyboard, named for
                            assistive tech, and it confirms the copy. */}
                        <button
                          type="button"
                          title={text}
                          onClick={() => copyCell(key, isNull ? '' : text)}
                          aria-label={`Copy ${column}: ${text}`}
                          className={cn(
                            'flex w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap',
                            'px-2.5 py-1 text-left transition-colors hover:bg-accent/10',
                            isCopied && 'bg-accent/15',
                            isNull && 'italic text-subtle',
                            typeof value === 'number' && 'justify-end text-right',
                          )}
                        >
                          {isCopied && (
                            <PopIn className="shrink-0">
                              <Check className="h-3 w-3 text-accent" aria-hidden />
                            </PopIn>
                          )}
                          <span className="truncate">{text}</span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            <tr aria-hidden>
              <td colSpan={result.columns.length} style={{ height: trailing, padding: 0, border: 0 }} />
            </tr>
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="py-10 text-center text-xs text-subtle">
            {filter ? 'No rows match the filter.' : 'The query returned no rows.'}
          </p>
        )}
      </div>

      {/* Copy confirmation for assistive tech, mirroring the visual flash. */}
      <div aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </div>
    </div>
  )
}
