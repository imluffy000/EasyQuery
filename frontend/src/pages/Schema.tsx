/**
 * Schema Explorer: tree of tables, then the detail for the selected one.
 *
 * Layout note: <main> in AppShell is `overflow-hidden`, so this page owns its
 * own scrolling. A fixed 288px tree beside the rail left the detail pane with
 * nothing to sit in below ~900px and it was clipped, not scrollable. The panes
 * are therefore stacked into one column below `lg` — tree first, capped so the
 * detail stays reachable — and only become side-by-side at `lg` and up.
 */

import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Key, Link2, Search, Table2 } from 'lucide-react'

import { AsyncBoundary, Badge, EmptyState, Panel, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { cn, formatCompact, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { TableMeta } from '@/types/api'

export function SchemaPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const treeId = useId()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['schema', workspaceId, databaseId],
    queryFn: () => api.databases.schema(workspaceId!, databaseId!),
    enabled: Boolean(workspaceId && databaseId),
  })

  const table = useMemo<TableMeta | null>(() => {
    if (!data || !selected) return null
    for (const schema of data.schemas) {
      const found = schema.tables.find((t) => `${schema.name}.${t.name}` === selected)
      if (found) return found
    }
    return null
  }, [data, selected])

  if (!databaseId) {
    return (
      <div className="h-full overflow-y-auto">
        <EmptyState
          icon={<Table2 className="h-7 w-7" aria-hidden />}
          title="No database selected"
          description="Choose a database from the top bar to explore its tables."
        />
      </div>
    )
  }

  // Loading, error and empty all resolve here so the tree is only ever built
  // from a schema that actually arrived — an error must never read as "zero
  // tables".
  if (isLoading || error || !data || data.schemas.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <AsyncBoundary
          isLoading={isLoading}
          isError={Boolean(error)}
          isEmpty
          onRetry={() => void refetch()}
          errorMessage="Could not load the schema."
          skeleton={
            <div className="mx-auto max-w-4xl space-y-1.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          }
          empty={
            <EmptyState
              icon={<Table2 className="h-7 w-7" aria-hidden />}
              title="Schema not synced"
              description="Sync the schema from the Databases page to explore tables and relationships."
            />
          }
        >
          {null}
        </AsyncBoundary>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const visible = data.schemas
    .map((schema) => ({
      schema,
      tables: schema.tables.filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.columns.some((c) => c.name.toLowerCase().includes(q)),
      ),
    }))
    .filter((group) => group.tables.length > 0)

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div
        className="flex w-full shrink-0 flex-col border-b border-border bg-surface
                   lg:h-full lg:w-72 lg:border-b-0 lg:border-r"
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables and columns"
            aria-label="Search schema"
            aria-controls={treeId}
            className="w-full bg-transparent text-xs text-fg placeholder:text-subtle focus:outline-none"
          />
        </div>

        {/*
          Capped rather than flex-1 when stacked, so the tree cannot push the
          detail pane off-screen on a narrow viewport.
        */}
        <div
          id={treeId}
          className="max-h-[40vh] overflow-y-auto p-1.5 lg:max-h-none lg:min-h-0 lg:flex-1"
        >
          {visible.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-xs text-muted">
              No table or column matches “{search.trim()}”.
            </p>
          ) : (
            visible.map(({ schema, tables }) => {
              const isCollapsed = Boolean(collapsed[schema.name])
              const groupId = `${treeId}-${schema.name}`

              return (
                <div key={schema.name} className="mb-1">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [schema.name]: !c[schema.name] }))}
                    aria-expanded={!isCollapsed}
                    aria-controls={groupId}
                    className="micro flex w-full items-center gap-1 px-1.5 py-1
                               cursor-pointer transition-colors hover:text-fg"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{schema.name}</span>
                    <span className="ml-auto font-mono normal-case tracking-normal">
                      {tables.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <ul id={groupId}>
                      {tables.map((t) => {
                        const key = `${schema.name}.${t.name}`
                        const isSelected = selected === key
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              onClick={() => setSelected(key)}
                              aria-current={isSelected ? true : undefined}
                              className={cn(
                                'flex w-full items-center gap-1.5 px-1.5 py-1 text-left',
                                'border-l-2 text-xs cursor-pointer transition-colors',
                                isSelected
                                  ? 'border-accent bg-elevated text-fg'
                                  : 'border-transparent text-muted hover:bg-elevated hover:text-fg',
                              )}
                            >
                              <Table2 className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
                              <span className="truncate font-mono">{t.name}</span>
                              <span className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-subtle">
                                {formatCompact(t.estimated_rows ?? 0)}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t border-border px-2.5 py-1.5">
          <p className="micro truncate">
            Synced {formatRelative(data.last_synced_at)} ·{' '}
            <span className="font-mono normal-case tracking-normal">v{data.schema_version}</span>
          </p>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 lg:p-4">
        {!table ? (
          <EmptyState
            icon={<Table2 className="h-7 w-7" aria-hidden />}
            title="Select a table"
            description="Choose a table to see its columns, keys, indexes, and relationships."
          />
        ) : (
          <TableDetail table={table} />
        )}
      </div>
    </div>
  )
}

function TableDetail({ table }: { table: TableMeta }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="border-b border-border pb-3">
        <p className="micro">Table</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-lg text-fg">{table.name}</h1>
          <Badge tone="neutral">{table.kind.replace('_', ' ')}</Badge>
        </div>
        {table.description && <p className="mt-1.5 text-xs text-muted">{table.description}</p>}
        <p className="readout mt-1.5">
          <span className="tabular-nums">{table.column_count} columns</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">~{formatCompact(table.estimated_rows ?? 0)} rows</span>
        </p>
      </header>

      <Panel title="Columns" bodyClassName="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Type</th>
              <th scope="col">Nullable</th>
              <th scope="col">Keys</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((c) => (
              <tr key={c.name}>
                <td className="font-medium text-fg">{c.name}</td>
                <td className="text-muted">{c.data_type}</td>
                <td className="text-muted">{c.nullable ? 'yes' : 'no'}</td>
                <td>
                  <span className="flex items-center gap-1">
                    {c.is_primary_key && (
                      <Badge tone="accent">
                        <Key className="h-2.5 w-2.5" aria-hidden /> PK
                      </Badge>
                    )}
                    {c.is_unique && <Badge tone="neutral">unique</Badge>}
                    {c.sensitivity !== 'none' && (
                      <Badge tone={c.sensitivity === 'high' ? 'danger' : 'warn'}>
                        {c.sensitivity} PII
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="max-w-xs truncate text-subtle">{c.comment ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {table.foreign_keys.length > 0 && (
        <Panel title="Relationships">
          <ul className="divide-y divide-border">
            {table.foreign_keys.map((fk) => (
              <li
                key={fk.constraint_name + fk.column}
                className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs"
              >
                <Link2 className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
                <span className="truncate text-fg">{fk.column}</span>
                <span className="shrink-0 text-subtle" aria-hidden>
                  →
                </span>
                <span className="sr-only">references</span>
                <span className="truncate text-accent">
                  {fk.references_schema}.{fk.references_table}.{fk.references_column}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {table.indexes.length > 0 && (
        <Panel title="Indexes">
          <ul className="divide-y divide-border">
            {table.indexes.map((ix) => (
              <li key={ix.name} className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs">
                <span className="truncate text-fg">{ix.name}</span>
                {ix.is_primary && <Badge tone="accent">primary</Badge>}
                {ix.is_unique && !ix.is_primary && <Badge tone="neutral">unique</Badge>}
                <span className="ml-auto shrink-0 text-subtle">{ix.method}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
