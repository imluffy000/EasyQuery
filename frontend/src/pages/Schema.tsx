/** Schema Explorer: tree on the left, table detail on the right. */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Key, Link2, Search, Table2 } from 'lucide-react'

import { Badge, EmptyState, ErrorState, Panel, Skeleton } from '@/components/ui'
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
    return <EmptyState title="No database selected" description="Choose a database to explore." />
  }
  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4">
        <ErrorState message="Could not load the schema." onRetry={() => void refetch()} />
      </div>
    )
  }
  if (!data || data.schemas.length === 0) {
    return (
      <EmptyState
        icon={<Table2 className="h-7 w-7" />}
        title="Schema not synced"
        description="Sync the schema from the Databases page to explore tables and relationships."
      />
    )
  }

  const q = search.trim().toLowerCase()

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables and columns"
            aria-label="Search schema"
            className="w-full bg-transparent text-xs text-fg placeholder:text-subtle focus:outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {data.schemas.map((schema) => {
            const tables = schema.tables.filter(
              (t) =>
                !q ||
                t.name.toLowerCase().includes(q) ||
                t.columns.some((c) => c.name.toLowerCase().includes(q)),
            )
            if (tables.length === 0) return null
            const isCollapsed = collapsed[schema.name]

            return (
              <div key={schema.name} className="mb-1">
                <button
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [schema.name]: !c[schema.name] }))
                  }
                  className="flex w-full items-center gap-1 rounded px-1.5 py-1
                             text-2xs font-medium uppercase tracking-wide text-subtle
                             cursor-pointer hover:text-fg"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3 w-3" aria-hidden />
                  )}
                  {schema.name}
                  <span className="ml-auto font-mono normal-case">{tables.length}</span>
                </button>

                {!isCollapsed && (
                  <ul>
                    {tables.map((t) => {
                      const key = `${schema.name}.${t.name}`
                      return (
                        <li key={key}>
                          <button
                            onClick={() => setSelected(key)}
                            className={cn(
                              'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left',
                              'text-xs cursor-pointer transition-colors',
                              selected === key
                                ? 'bg-elevated text-fg'
                                : 'text-muted hover:bg-elevated/60 hover:text-fg',
                            )}
                          >
                            <Table2 className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
                            <span className="truncate font-mono">{t.name}</span>
                            <span className="ml-auto shrink-0 font-mono text-2xs text-subtle">
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
          })}
        </div>

        <div className="shrink-0 border-t border-border px-2.5 py-1.5">
          <p className="text-2xs text-subtle">
            Synced {formatRelative(data.last_synced_at)} · v{data.schema_version}
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {!table ? (
          <EmptyState
            icon={<Table2 className="h-7 w-7" />}
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
      <header>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-lg text-fg">{table.name}</h1>
          <Badge tone="neutral">{table.kind.replace('_', ' ')}</Badge>
        </div>
        {table.description && <p className="mt-1 text-xs text-muted">{table.description}</p>}
        <p className="mt-1 font-mono text-2xs text-subtle">
          {table.column_count} columns · ~{formatCompact(table.estimated_rows ?? 0)} rows
        </p>
      </header>

      <Panel title="Columns" bodyClassName="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Nullable</th>
              <th>Keys</th>
              <th>Notes</th>
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
                <span className="text-fg">{fk.column}</span>
                <span className="text-subtle">→</span>
                <span className="text-accent">
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
