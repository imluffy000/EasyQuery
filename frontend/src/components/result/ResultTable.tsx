/**
 * Result table.
 *
 * Rows are virtualized: a 10,000-row result must not put 10,000 <tr> nodes in
 * the DOM. Column widths are resizable because generated queries return
 * columns we cannot anticipate.
 */

import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Download, Maximize2, Minimize2, Search } from 'lucide-react'

import { Badge, Button } from '@/components/ui'
import { cn, formatCell, formatDuration, formatNumber } from '@/lib/utils'
import type { QueryResult } from '@/types/api'

const ROW_HEIGHT = 28
const MIN_WIDTH = 90

interface Props {
  result: QueryResult
  className?: string
}

export function ResultTable({ result, className }: Props) {
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null)
  const [filter, setFilter] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const exportCsv = () => {
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      result.columns.join(','),
      ...rows.map((r) => result.columns.map((c) => escape(r[c])).join(',')),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `query-result-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-surface',
        fullscreen && 'fixed inset-3 z-50 shadow-popover',
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
        <span className="font-mono text-2xs text-muted">
          {formatNumber(rows.length)}
          {rows.length !== result.row_count && ` of ${formatNumber(result.row_count)}`} rows
        </span>
        <span className="font-mono text-2xs text-subtle">{formatDuration(result.duration_ms)}</span>
        {result.truncated && (
          <Badge tone="warn" className="shrink-0">
            may be incomplete
          </Badge>
        )}

        <div className="flex-1" />

        <div className="flex h-6 items-center gap-1.5 rounded border border-border bg-bg px-1.5">
          <Search className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows"
            aria-label="Filter rows"
            className="w-28 bg-transparent text-2xs text-fg placeholder:text-subtle focus:outline-none"
          />
        </div>
        <Button size="sm" variant="ghost" onClick={exportCsv} title="Export CSV">
          <Download className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table className="data-table" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              {result.columns.map((column) => {
                const active = sort?.column === column
                return (
                  <th
                    key={column}
                    style={{ width: widths[column] ?? 150 }}
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
                      className="flex w-full items-center gap-1 cursor-pointer text-left
                                 hover:text-fg"
                    >
                      <span className="truncate">{column}</span>
                      {active &&
                        (sort.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0 text-accent" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0 text-accent" aria-hidden />
                        ))}
                    </button>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        startResize(column, e.clientX, widths[column] ?? 150)
                      }}
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize
                                 bg-transparent hover:bg-accent/40"
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {items.length > 0 && items[0] && (
              <tr style={{ height: items[0].start }} aria-hidden />
            )}
            {items.map((item) => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <tr key={item.key} style={{ height: ROW_HEIGHT }}>
                  {result.columns.map((column) => {
                    const value = row[column]
                    const isNull = value === null || value === undefined
                    return (
                      <td
                        key={column}
                        style={{ width: widths[column] ?? 150 }}
                        title={isNull ? 'NULL' : formatCell(value)}
                        onClick={() =>
                          navigator.clipboard?.writeText(isNull ? '' : formatCell(value))
                        }
                        className={cn(
                          'cursor-pointer overflow-hidden text-ellipsis',
                          isNull && 'italic text-subtle',
                          typeof value === 'number' && 'text-right tabular-nums',
                        )}
                      >
                        {formatCell(value)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            <tr
              style={{
                height:
                  virtualizer.getTotalSize() -
                  (items.length && items[items.length - 1]
                    ? items[items.length - 1]!.end
                    : 0),
              }}
              aria-hidden
            />
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="py-10 text-center text-xs text-subtle">
            {filter ? 'No rows match the filter.' : 'The query returned no rows.'}
          </p>
        )}
      </div>
    </div>
  )
}
