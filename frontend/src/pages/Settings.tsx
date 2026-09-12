import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'

import {
  Badge,
  Button,
  ConfirmDelete,
  EmptyState,
  ErrorState,
  Input,
  Panel,
  Select,
  SuccessState,
} from '@/components/ui'
import { ApiRequestError, api } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/unsavedChanges'
import { useAppStore } from '@/stores/useAppStore'
import type { GlossaryTerm } from '@/types/api'

export function SettingsPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const databaseId = useAppStore((s) => s.databaseId)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const queryClient = useQueryClient()

  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [mapsTo, setMapsTo] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  // A part-typed glossary entry is unsaved work: it exists nowhere else.
  useUnsavedGuard(
    'glossary-form',
    term.trim() !== '' || definition.trim() !== '' || mapsTo.trim() !== '',
  )

  // Each of these reads isError as well as data. Without it a failed request
  // renders as an em-dash, which is indistinguishable from "not set".
  const {
    data: user,
    isError: userError,
    refetch: refetchUser,
  } = useQuery({ queryKey: ['me'], queryFn: api.auth.me })

  const {
    data: memberships = [],
    isError: membershipsError,
    refetch: refetchMemberships,
  } = useQuery({
    queryKey: ['memberships'],
    queryFn: api.auth.memberships,
  })

  const {
    data: glossary = [],
    isError: glossaryError,
    refetch: refetchGlossary,
  } = useQuery({
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
      setNotice('Glossary term added successfully.')
      queryClient.invalidateQueries({ queryKey: ['glossary'] })
    },
  })

  const removeTerm = useMutation({
    mutationFn: (id: string) => api.databases.removeTerm(workspaceId!, databaseId!, id),
    onSuccess: () => {
      setNotice('Glossary term deleted successfully.')
      queryClient.invalidateQueries({ queryKey: ['glossary'] })
    },
  })

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-3">
        <header className="mb-1 border-b border-border pb-3">
          <p className="micro">Workspace</p>
          <h1 className="mt-0.5 text-lg font-medium text-fg">Settings</h1>
        </header>

        <Panel title="Profile">
          <div className="p-3">
            {userError ? (
              <ErrorState message="Could not load your profile." onRetry={() => void refetchUser()} />
            ) : (
              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="micro">Email</dt>
                  <dd className="mt-0.5 font-mono text-fg">{user?.email ?? '—'}</dd>
                </div>
                <div>
                  <dt className="micro">Name</dt>
                  <dd className="mt-0.5 text-fg">{user?.full_name || '—'}</dd>
                </div>
              </dl>
            )}
          </div>
        </Panel>

        <Panel title="Workspace and role">
          <div className="space-y-3 p-3">
            {membershipsError ? (
              <ErrorState
                message="Could not load your workspace membership."
                onRetry={() => void refetchMemberships()}
              />
            ) : (
              <>
                <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="micro">Workspace</dt>
                    <dd className="mt-0.5 text-fg">{membership?.workspace.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="micro">Role</dt>
                    <dd className="mt-0.5">
                      <Badge tone="accent">{membership?.role ?? '—'}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="micro">Row ceiling</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-fg">
                      {membership?.workspace.max_rows.toLocaleString() ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="micro">Query timeout</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-fg">
                      {membership?.workspace.query_timeout_seconds ?? '—'}s
                    </dd>
                  </div>
                </dl>
                <div>
                  <p className="micro mb-1">Permissions</p>
                  <ul className="flex flex-wrap gap-1">
                    {(membership?.permissions ?? []).map((p) => (
                      <li key={p}>
                        <Badge tone="neutral">{p.replace(/_/g, ' ')}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
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
          actions={<span className="micro">Improves SQL accuracy</span>}
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
                {/* One column on a phone: three side-by-side fields at 375px
                    leaves each about 90px wide. */}
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
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
                  onClick={() => {
                    setNotice(null)
                    addTerm.mutate()
                  }}
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  {addTerm.isPending ? 'Adding...' : 'Add term'}
                </Button>

                {notice && (
                  <div className="mt-3">
                    <SuccessState message={notice} onDismiss={() => setNotice(null)} />
                  </div>
                )}

                {addTerm.isError && (
                  <div className="mt-3">
                    <ErrorState
                      message={
                        addTerm.error instanceof ApiRequestError
                          ? addTerm.error.message
                          : 'Could not add the term.'
                      }
                    />
                  </div>
                )}

                {glossaryError ? (
                  <div className="mt-3">
                    <ErrorState
                      message="Could not load the glossary."
                      onRetry={() => void refetchGlossary()}
                    />
                  </div>
                ) : (
                  glossary.length > 0 && (
                    <ul className="mt-3 divide-y divide-border border border-border">
                      {glossary.map((g) => (
                        <GlossaryRow
                          key={g.id}
                          entry={g}
                          onRemove={() => removeTerm.mutate(g.id)}
                          removing={removeTerm.isPending && removeTerm.variables === g.id}
                          removeError={
                            removeTerm.error && removeTerm.variables === g.id
                              ? removeTerm.error instanceof ApiRequestError
                                ? removeTerm.error.message
                                : 'Could not delete this term.'
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  )
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function GlossaryRow({
  entry,
  onRemove,
  removing,
  removeError,
}: {
  entry: GlossaryTerm
  onRemove: () => void
  removing: boolean
  removeError?: string
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
      <span className="font-mono text-xs font-medium text-fg">{entry.term}</span>
      <span className="text-subtle" aria-hidden>
        =
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {entry.definition}
        {entry.maps_to && <span className="ml-1 font-mono text-accent">→ {entry.maps_to}</span>}
      </span>
      {/* Was a bare trash icon that deleted immediately; now the same confirm
          gesture used on Databases and Saved. */}
      <ConfirmDelete
        label={`Delete ${entry.term}`}
        onConfirm={onRemove}
        pending={removing}
        error={removeError}
        confirming={confirming}
        setConfirming={setConfirming}
      />
    </li>
  )
}
