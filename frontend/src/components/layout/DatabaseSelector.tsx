/**
 * Database selector.
 *
 * Always visible in the top bar: the user must be able to see which database
 * a question will run against without opening anything (spec section 4).
 *
 * Accessibility notes, because this control got them wrong before:
 *
 *   - The popup is NOT a listbox. A listbox owns `option` children and options
 *     are flattened to text, so the search field and the per-row favourite
 *     button were either unreachable or silently dropped from the a11y tree.
 *     It is exposed for what it structurally is: a non-modal dialog holding a
 *     search field and a list of buttons, with the favourite toggle as a
 *     SIBLING button of the row it belongs to.
 *   - Focus returns to the trigger on every close path, so keyboard users are
 *     never dropped onto <body>.
 *   - Every icon that carries meaning is paired with real text. A bare lucide
 *     <svg> has no role, so `aria-label` on it is not mapped to the a11y tree.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Search, Star, Lock } from 'lucide-react'

import { AsyncBoundary, Badge, EmptyState, Skeleton, StatusDot } from '@/components/ui'
import { api } from '@/lib/api'
import { cn, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { DatabaseConnection } from '@/types/api'

const ENV_TONE = {
  production: 'danger',
  staging: 'warn',
  development: 'neutral',
} as const

export function statusTone(status: DatabaseConnection['status']) {
  return status === 'connected' ? 'ok' : status === 'error' ? 'danger' : 'warn'
}

export function DatabaseSelector() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const setDatabase = useAppStore((s) => s.setDatabase)
  const favorites = useAppStore((s) => s.favoriteDatabases)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const recents = useAppStore((s) => s.recentDatabases)

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const {
    data: databases = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['databases', workspaceId],
    queryFn: () => api.databases.list(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const selected = databases.find((d) => d.id === databaseId) ?? null

  /** Close and hand focus back to the trigger — the only way out of the popup. */
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Auto-select when there is exactly one, so a new user is not asked to pick
  // from a list of one.
  useEffect(() => {
    if (!databaseId && databases.length > 0) setDatabase(databases[0]!.id)
  }, [databaseId, databases, setDatabase])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      const container = containerRef.current
      if (container?.contains(e.target as Node)) return
      const focusWasInside = container?.contains(document.activeElement)
      setOpen(false)
      // Let the browser move focus to whatever was clicked first; only rescue
      // focus to the trigger if the click landed on something unfocusable and
      // focus would otherwise have fallen to <body>.
      if (focusWasInside) {
        window.setTimeout(() => {
          const active = document.activeElement
          if (!active || active === document.body) triggerRef.current?.focus()
        }, 0)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = databases.filter(
      (d) =>
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.database_name.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q),
    )
    const rank = (d: DatabaseConnection) => {
      if (favorites.includes(d.id)) return 0
      const recentIndex = recents.indexOf(d.id)
      return recentIndex === -1 ? 2 : 1
    }
    return [...matches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [databases, search, favorites, recents])

  if (!workspaceId) return null

  const showFallback = isLoading || isError || grouped.length === 0

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="flex h-7 max-w-xs items-center gap-2 border border-border-control
                   bg-bg px-2 text-xs cursor-pointer transition-colors hover:bg-elevated"
      >
        {selected ? (
          <>
            <StatusDot tone={statusTone(selected.status)} />
            <span className="truncate font-medium text-fg">{selected.name}</span>
            <span className="truncate font-mono text-2xs text-subtle">
              {selected.allowed_schemas[0] ?? 'public'}
            </span>
            {selected.read_only && (
              <>
                {/* lucide renders a bare <svg> with no role, so aria-label on it
                    is not exposed. The state has to be real text. */}
                <Lock className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
                <span className="sr-only">Read-only</span>
              </>
            )}
          </>
        ) : (
          <span className="text-muted">Select database</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose a database"
          className="absolute left-0 top-9 z-50 w-80 animate-slide-up overflow-hidden
                     border border-border-strong bg-surface shadow-popover"
        >
          <div className="flex items-center gap-2 border-b border-border bg-elevated px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search databases"
              aria-label="Search databases"
              className="w-full bg-transparent text-xs text-fg placeholder:text-subtle
                         focus:outline-none"
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {showFallback ? (
              <div className="p-2">
                <AsyncBoundary
                  isLoading={isLoading}
                  isError={isError}
                  isEmpty
                  onRetry={() => void refetch()}
                  errorMessage="Could not load databases."
                  skeleton={
                    <div className="space-y-1.5">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  }
                  empty={
                    databases.length === 0 ? (
                      <EmptyState
                        title="No databases connected"
                        description="Add a connection from the Databases page to get started."
                      />
                    ) : (
                      <EmptyState
                        title="No matches"
                        description={`Nothing matches “${search.trim()}”.`}
                      />
                    )
                  }
                >
                  {null}
                </AsyncBoundary>
              </div>
            ) : (
              <ul aria-label="Databases" className="py-1">
                {grouped.map((db) => {
                  const isSelected = db.id === databaseId
                  const isFavorite = favorites.includes(db.id)
                  return (
                    <li
                      key={db.id}
                      className={cn('flex items-start gap-1', isSelected && 'bg-elevated')}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setDatabase(db.id)
                          close()
                        }}
                        aria-current={isSelected ? true : undefined}
                        className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-1.5 text-left
                                   cursor-pointer transition-colors hover:bg-elevated"
                      >
                        <span className="mt-1 flex shrink-0">
                          <StatusDot tone={statusTone(db.status)} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-fg">{db.name}</span>
                            <Badge tone={ENV_TONE[db.environment]}>{db.environment}</Badge>
                            {db.read_only && <Badge tone="neutral">read-only</Badge>}
                          </span>
                          <span className="block truncate font-mono text-2xs text-subtle">
                            {db.engine} · {db.database_name} · {db.allowed_schemas.join(', ')}
                          </span>
                          <span className="block text-2xs text-subtle">
                            {db.last_synced_at
                              ? `Schema synced ${formatRelative(db.last_synced_at)}`
                              : 'Schema not yet synced'}
                          </span>
                        </span>
                        {isSelected && (
                          <>
                            <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                            <span className="sr-only">Current database</span>
                          </>
                        )}
                      </button>

                      {/*
                        Sibling of the row, not a child of it: a button nested
                        inside a selectable row is flattened away by screen
                        readers and unreachable by keyboard.
                      */}
                      <button
                        type="button"
                        onClick={() => toggleFavorite(db.id)}
                        aria-pressed={isFavorite}
                        aria-label={`Favourite ${db.name}`}
                        className="mr-1 mt-1.5 shrink-0 cursor-pointer p-1 text-subtle
                                   transition-colors hover:text-warn"
                      >
                        <Star
                          className={cn('h-3.5 w-3.5', isFavorite && 'fill-warn text-warn')}
                          aria-hidden
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
