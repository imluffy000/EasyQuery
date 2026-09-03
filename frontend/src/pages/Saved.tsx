import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark } from 'lucide-react'

import { SqlViewer } from '@/components/chat/SqlPanel'
import {
  AsyncBoundary,
  Badge,
  Button,
  ConfirmDelete,
  EmptyState,
  ErrorState,
  Input,
  Panel,
  Skeleton,
} from '@/components/ui'
import { ApiRequestError, api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { SavedQuery } from '@/types/api'

export function SavedPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [sql, setSql] = useState('SELECT ')
  const [tags, setTags] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // isError is read, not just data: a failed fetch must not be presented as
  // "you have no saved queries".
  const {
    data: saved = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['saved', workspaceId],
    queryFn: () => api.queries.saved(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const create = useMutation({
    mutationFn: () =>
      api.queries.save(workspaceId!, {
        name,
        sql,
        database_id: databaseId,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      setName('')
      setSql('SELECT ')
      setTags('')
      setCreating(false)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['saved'] })
    },
    onError: (err) =>
      // The backend validates saved SQL through the same guard, so a blocked
      // statement is rejected here rather than at run time.
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the query.'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.queries.removeSaved(workspaceId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved'] }),
  })

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <p className="micro">Library</p>
            <h1 className="mt-0.5 text-lg font-medium text-fg">Saved queries</h1>
            <p className="mt-0.5 text-xs text-muted">
              Saved SQL is validated by the same guard that protects generated queries.
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            <Bookmark className="h-3.5 w-3.5" aria-hidden /> New saved query
          </Button>
        </header>

        {creating && (
          <Panel title="New saved query" className="mb-3">
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                  label="Tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  hint="Comma-separated"
                />
              </div>
              <div role="group" aria-labelledby="saved-sql-label">
                {/* Not a <label>: the editor is a composite widget, so the name
                    is carried by the group and by the editor's own aria-label. */}
                <span id="saved-sql-label" className="label">
                  SQL
                </span>
                <div className="overflow-hidden border border-border-control">
                  <SqlViewer
                    sql={sql}
                    onChange={setSql}
                    readOnly={false}
                    height={160}
                    ariaLabel="SQL for the saved query"
                  />
                </div>
              </div>
              {error && <ErrorState message={error} />}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  loading={create.isPending}
                  disabled={!name.trim() || !sql.trim()}
                  onClick={() => create.mutate()}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Panel>
        )}

        <AsyncBoundary
          isLoading={isLoading}
          isError={isError}
          isEmpty={saved.length === 0 && !creating}
          onRetry={() => void refetch()}
          errorMessage="Could not load saved queries."
          skeleton={
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          }
          empty={
            <div className="panel">
              <EmptyState
                icon={<Bookmark className="h-7 w-7" />}
                title="No saved queries"
                description="Save a query to re-run it without re-asking the question."
              />
            </div>
          }
        >
          <ul className="space-y-2">
            {saved.map((q) => (
              <SavedRow
                key={q.id}
                query={q}
                onRemove={() => remove.mutate(q.id)}
                removing={remove.isPending && remove.variables === q.id}
                removeError={
                  remove.error && remove.variables === q.id
                    ? remove.error instanceof ApiRequestError
                      ? remove.error.message
                      : 'Could not delete this query.'
                    : undefined
                }
              />
            ))}
          </ul>
        </AsyncBoundary>
      </div>
    </div>
  )
}

function SavedRow({
  query,
  onRemove,
  removing,
  removeError,
}: {
  query: SavedQuery
  onRemove: () => void
  removing: boolean
  removeError?: string
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="panel p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium text-fg">{query.name}</p>
            {query.tags.map((t) => (
              <Badge key={t} tone="neutral">
                {t}
              </Badge>
            ))}
          </div>
          {query.description && <p className="mt-0.5 text-xs text-muted">{query.description}</p>}
          <p className="mt-1 font-mono text-2xs tabular-nums text-subtle">
            Created {formatRelative(query.created_at)} · run {query.run_count} times
          </p>
          <pre className="mt-2 overflow-x-auto border border-border bg-sunken p-2 font-mono text-2xs text-fg">
            {query.sql}
          </pre>
        </div>
        {/* Same two-step confirm as Databases and Settings. */}
        <div className="flex max-w-[15rem] shrink-0 flex-wrap items-center justify-end gap-1">
          <ConfirmDelete
            label={`Delete saved query ${query.name}`}
            onConfirm={onRemove}
            pending={removing}
            error={removeError}
            confirming={confirming}
            setConfirming={setConfirming}
          />
        </div>
      </div>
    </li>
  )
}
