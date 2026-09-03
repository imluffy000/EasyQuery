import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Trash2 } from 'lucide-react'

import { Badge, Button, EmptyState, Input, Panel, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/useAppStore'

export function SettingsPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const queryClient = useQueryClient()

  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [mapsTo, setMapsTo] = useState('')

  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.auth.me })
  const { data: memberships = [] } = useQuery({
    queryKey: ['memberships'],
    queryFn: api.auth.memberships,
  })
  const { data: glossary = [] } = useQuery({
    queryKey: ['glossary', workspaceId, databaseId],
    queryFn: () => api.databases.glossary(workspaceId!, databaseId!),
    enabled: Boolean(workspaceId && databaseId),
  })

  const membership = memberships.find((m) => m.workspace.id === workspaceId)

  const addTerm = useMutation({
    mutationFn: () =>
      api.databases.addTerm(workspaceId!, databaseId!, {
        term,
        definition,
        maps_to: mapsTo || null,
      }),
    onSuccess: () => {
      setTerm('')
      setDefinition('')
      setMapsTo('')
      queryClient.invalidateQueries({ queryKey: ['glossary'] })
    },
  })

  const removeTerm = useMutation({
    mutationFn: (id: string) => api.databases.removeTerm(workspaceId!, databaseId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['glossary'] }),
  })

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-3">
        <header className="mb-1">
          <h1 className="text-lg font-medium">Settings</h1>
        </header>

        <Panel title="Profile">
          <dl className="grid grid-cols-2 gap-3 p-3 text-xs">
            <div>
              <dt className="text-2xs text-subtle">Email</dt>
              <dd className="font-mono text-fg">{user?.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-2xs text-subtle">Name</dt>
              <dd className="text-fg">{user?.full_name || '—'}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Workspace and role">
          <div className="space-y-3 p-3">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-2xs text-subtle">Workspace</dt>
                <dd className="text-fg">{membership?.workspace.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Role</dt>
                <dd>
                  <Badge tone="accent">{membership?.role ?? '—'}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Row ceiling</dt>
                <dd className="font-mono text-fg">
                  {membership?.workspace.max_rows.toLocaleString() ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Query timeout</dt>
                <dd className="font-mono text-fg">
                  {membership?.workspace.query_timeout_seconds ?? '—'}s
                </dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-2xs text-subtle">Permissions</p>
              <ul className="flex flex-wrap gap-1">
                {(membership?.permissions ?? []).map((p) => (
                  <li key={p}>
                    <Badge tone="neutral">{p.replace(/_/g, ' ')}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>

        <Panel title="Appearance">
          <div className="w-48 p-3">
            <Select
              label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </div>
        </Panel>

        <Panel
          title="Business glossary"
          actions={<span className="text-2xs text-subtle">Improves SQL accuracy</span>}
        >
          <div className="p-3">
            <p className="mb-3 text-xs text-muted">
              Definitions the planner treats as authoritative. Defining what &ldquo;revenue&rdquo;
              or &ldquo;active user&rdquo; means for your schema is the cheapest way to raise
              accuracy.
            </p>

            {!databaseId ? (
              <EmptyState title="Select a database" description="Glossary terms are per database." />
            ) : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <Input
                    label="Term"
                    placeholder="revenue"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                  />
                  <Input
                    label="Definition"
                    placeholder="Completed order gross value"
                    value={definition}
                    onChange={(e) => setDefinition(e.target.value)}
                  />
                  <Input
                    label="Maps to"
                    placeholder="orders.total_amount"
                    value={mapsTo}
                    onChange={(e) => setMapsTo(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!term.trim() || !definition.trim()}
                  loading={addTerm.isPending}
                  onClick={() => addTerm.mutate()}
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden /> Add term
                </Button>

                {glossary.length > 0 && (
                  <ul className="mt-3 divide-y divide-border rounded border border-border">
                    {glossary.map((g) => (
                      <li key={g.id} className="flex items-center gap-2 px-2.5 py-1.5">
                        <span className="font-mono text-xs font-medium text-fg">{g.term}</span>
                        <span className="text-subtle">=</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">
                          {g.definition}
                          {g.maps_to && (
                            <span className="ml-1 font-mono text-accent">→ {g.maps_to}</span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeTerm.mutate(g.id)}
                          aria-label={`Delete ${g.term}`}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
