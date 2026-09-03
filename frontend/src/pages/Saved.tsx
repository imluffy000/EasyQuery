import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Trash2 } from 'lucide-react'

import { SqlViewer } from '@/components/chat/SqlPanel'
import { Badge, Button, EmptyState, ErrorState, Input, Panel } from '@/components/ui'
import { ApiRequestError, api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

export function SavedPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [sql, setSql] = useState('SELECT ')
  const [tags, setTags] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: saved = [] } = useQuery({
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
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium">Saved queries</h1>
            <p className="text-xs text-muted">
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
              <div className="grid grid-cols-2 gap-2">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                  label="Tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  hint="Comma-separated"
                />
              </div>
              <div>
                <label className="label">SQL</label>
                <div className="overflow-hidden rounded border border-border">
                  <SqlViewer sql={sql} onChange={setSql} readOnly={false} height={160} />
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

        {saved.length === 0 && !creating ? (
          <div className="panel">
            <EmptyState
              icon={<Bookmark className="h-7 w-7" />}
              title="No saved queries"
              description="Save a query to re-run it without re-asking the question."
            />
          </div>
        ) : (
          <ul className="space-y-2">
            {saved.map((q) => (
              <li key={q.id} className="panel p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium text-fg">{q.name}</p>
                      {q.tags.map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    {q.description && <p className="mt-0.5 text-xs text-muted">{q.description}</p>}
                    <p className="mt-0.5 font-mono text-2xs text-subtle">
                      Created {formatRelative(q.created_at)} · run {q.run_count} times
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded border border-border bg-bg p-2 font-mono text-2xs text-fg">
                      {q.sql}
                    </pre>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(q.id)}
                    title="Delete saved query"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
