/**
 * Database selector.
 *
 * Always visible in the top bar: the user must be able to see which database
 * a question will run against without opening anything (spec section 4).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Search, Star, Lock } from 'lucide-react'

import { Badge, StatusDot } from '@/components/ui'
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

  const { data: databases = [] } = useQuery({
    queryKey: ['databases', workspaceId],
    queryFn: () => api.databases.list(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const selected = databases.find((d) => d.id === databaseId) ?? null

  // Auto-select when there is exactly one, so a new user is not asked to pick
  // from a list of one.
  useEffect(() => {
    if (!databaseId && databases.length > 0) setDatabase(databases[0]!.id)
  }, [databaseId, databases, setDatabase])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-7 max-w-xs items-center gap-2 rounded border border-border
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
              <Lock className="h-3 w-3 shrink-0 text-subtle" aria-label="Read-only" />
            )}
          </>
        ) : (
          <span className="text-muted">Select database</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-9 z-50 w-80 animate-slide-up overflow-hidden
                     rounded-lg border border-border bg-surface shadow-popover"
        >
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
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

          <ul className="max-h-80 overflow-y-auto py-1">
            {grouped.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-subtle">
                {databases.length === 0 ? 'No databases connected' : 'No matches'}
              </li>
            )}
            {grouped.map((db) => {
              const isSelected = db.id === databaseId
              const isFavorite = favorites.includes(db.id)
              return (
                <li key={db.id}>
                  <div
                    className={cn(
                      'group flex items-start gap-2 px-2.5 py-1.5 cursor-pointer',
                      'transition-colors hover:bg-elevated',
                      isSelected && 'bg-elevated',
                    )}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => {
                      setDatabase(db.id)
                      setOpen(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setDatabase(db.id)
                        setOpen(false)
                      }
                    }}
                  >
                    <div className="mt-1">
                      <StatusDot tone={statusTone(db.status)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-fg">{db.name}</span>
                        <Badge tone={ENV_TONE[db.environment]}>{db.environment}</Badge>
                        {db.read_only && <Badge tone="neutral">read-only</Badge>}
                      </div>
                      <p className="truncate font-mono text-2xs text-subtle">
                        {db.engine} · {db.database_name} · {db.allowed_schemas.join(', ')}
                      </p>
                      <p className="text-2xs text-subtle">
                        {db.last_synced_at
                          ? `Schema synced ${formatRelative(db.last_synced_at)}`
                          : 'Schema not yet synced'}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(db.id)
                      }}
                      aria-label={isFavorite ? 'Remove favourite' : 'Add favourite'}
                      className="mt-0.5 shrink-0 cursor-pointer p-0.5 text-subtle
                                 hover:text-warn"
                    >
                      <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-warn text-warn')} />
                    </button>
                    {isSelected && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
