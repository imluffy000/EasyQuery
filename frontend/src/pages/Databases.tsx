/** Database list plus the multi-step connection wizard (spec section 10). */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Database,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'

import { statusTone } from '@/components/layout/DatabaseSelector'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Select,
  StatusDot,
} from '@/components/ui'
import { ApiRequestError, api } from '@/lib/api'
import { cn, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { ConnectionTest, DatabaseConnection } from '@/types/api'

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  supabase: 6543,
  mysql: 3306,
  sqlite: 0,
}

export function DatabasesPage() {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const setDatabase = useAppStore((s) => s.setDatabase)
  const queryClient = useQueryClient()
  const [wizardOpen, setWizardOpen] = useState(false)

  const { data: databases = [], isLoading, error, refetch } = useQuery({
    queryKey: ['databases', workspaceId],
    queryFn: () => api.databases.list(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const sync = useMutation({
    mutationFn: (id: string) => api.databases.sync(workspaceId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['databases'] })
      queryClient.invalidateQueries({ queryKey: ['schema'] })
    },
  })

  const test = useMutation({
    mutationFn: (id: string) => api.databases.test(workspaceId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['databases'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.databases.remove(workspaceId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['databases'] }),
  })

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium">Databases</h1>
            <p className="text-xs text-muted">
              Connections are stored with encrypted credentials and queried read-only.
            </p>
          </div>
          <Button variant="primary" onClick={() => setWizardOpen(true)}>
            <Plug className="h-3.5 w-3.5" aria-hidden /> Connect database
          </Button>
        </header>

        {error && <ErrorState message="Could not load databases." onRetry={() => void refetch()} />}

        {!isLoading && databases.length === 0 && !error && (
          <div className="panel">
            <EmptyState
              icon={<Database className="h-7 w-7" />}
              title="No databases connected"
              description="Connect your PostgreSQL or Supabase database to start asking questions about your data."
              action={
                <Button variant="primary" onClick={() => setWizardOpen(true)}>
                  Connect database
                </Button>
              }
            />
          </div>
        )}

        <ul className="space-y-2">
          {databases.map((db) => (
            <li key={db.id}>
              <ConnectionCard
                db={db}
                syncing={sync.isPending && sync.variables === db.id}
                testing={test.isPending && test.variables === db.id}
                testResult={test.data && test.variables === db.id ? test.data : null}
                onSelect={() => setDatabase(db.id)}
                onSync={() => sync.mutate(db.id)}
                onTest={() => test.mutate(db.id)}
                onRemove={() => remove.mutate(db.id)}
              />
            </li>
          ))}
        </ul>
      </div>

      {wizardOpen && <ConnectionWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}

function ConnectionCard({
  db,
  syncing,
  testing,
  testResult,
  onSelect,
  onSync,
  onTest,
  onRemove,
}: {
  db: DatabaseConnection
  syncing: boolean
  testing: boolean
  testResult: ConnectionTest | null
  onSelect: () => void
  onSync: () => void
  onTest: () => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="panel p-3">
      <div className="flex items-start gap-3">
        <div className="mt-1.5">
          <StatusDot tone={statusTone(db.status)} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={onSelect}
              className="text-sm font-medium text-fg cursor-pointer hover:text-accent"
            >
              {db.name}
            </button>
            <Badge tone={db.environment === 'production' ? 'danger' : 'neutral'}>
              {db.environment}
            </Badge>
            {db.read_only && (
              <Badge tone="ok">
                <ShieldCheck className="h-2.5 w-2.5" aria-hidden /> read-only
              </Badge>
            )}
          </div>

          <p className="mt-0.5 truncate font-mono text-2xs text-subtle">
            {db.engine} · {db.username}@{db.host}:{db.port}/{db.database_name} ·{' '}
            {db.allowed_schemas.join(', ')}
          </p>

          <p className="mt-0.5 text-2xs text-muted">
            {db.last_synced_at
              ? `Schema synced ${formatRelative(db.last_synced_at)} · v${db.schema_version}`
              : 'Schema not synced yet'}
            {' · '}
            {db.max_rows.toLocaleString()} row cap · {db.query_timeout_seconds}s timeout
          </p>

          {db.last_error && <p className="mt-1 text-2xs text-danger">{db.last_error}</p>}

          {testResult && (
            <p
              className={cn(
                'mt-1 text-2xs',
                testResult.ok ? 'text-ok' : 'text-danger',
              )}
            >
              {testResult.message}
              {testResult.server_version && ` · ${testResult.server_version}`}
              {testResult.latency_ms != null && ` · ${testResult.latency_ms}ms`}
              {testResult.is_read_only_role === false &&
                ' · this role can write; a dedicated read-only role is recommended'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onTest} loading={testing} title="Test connection">
            <Plug className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={onSync} loading={syncing} title="Sync schema">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {confirming ? (
            <>
              <Button size="sm" variant="danger" onClick={onRemove}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(true)}
              title="Remove connection"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const STEPS = ['Engine', 'Connection', 'Security', 'Test', 'Import'] as const

function ConnectionWizard({ onClose }: { onClose: () => void }) {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const setDatabase = useAppStore((s) => s.setDatabase)
  const queryClient = useQueryClient()

  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const [created, setCreated] = useState<DatabaseConnection | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    name: '',
    engine: 'postgres',
    environment: 'development',
    host: 'localhost',
    port: 5432,
    database_name: '',
    username: '',
    password: '',
    ssl_mode: 'require',
    read_only: true,
    allowed_schemas: 'public',
    query_timeout_seconds: 30,
    max_rows: 10000,
  })

  const payload = () => ({
    ...form,
    port: Number(form.port),
    max_rows: Number(form.max_rows),
    query_timeout_seconds: Number(form.query_timeout_seconds),
    allowed_schemas: form.allowed_schemas
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const runTest = async () => {
    setBusy(true)
    setError(null)
    try {
      setTest(await api.databases.testNew(workspaceId!, payload()))
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Connection test failed.')
    } finally {
      setBusy(false)
    }
  }

  const saveAndSync = async () => {
    setBusy(true)
    setError(null)
    try {
      const connection = created ?? (await api.databases.create(workspaceId!, payload()))
      setCreated(connection)
      const result = await api.databases.sync(workspaceId!, connection.id)
      setSyncResult(`${result.tables} tables, ${result.columns} columns`)
      setDatabase(connection.id)
      queryClient.invalidateQueries({ queryKey: ['databases'] })
      queryClient.invalidateQueries({ queryKey: ['schema'] })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect a database"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-popover">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <h2 className="text-sm font-medium">Connect a database</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </header>

        <ol className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-1">
              <span
                className={cn(
                  'flex h-5 items-center gap-1 rounded px-1.5 text-2xs',
                  i === step
                    ? 'bg-accent text-accent-fg font-medium'
                    : i < step
                      ? 'text-ok'
                      : 'text-subtle',
                )}
              >
                {i < step && <Check className="h-2.5 w-2.5" aria-hidden />}
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="text-subtle">·</span>}
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {step === 0 && (
            <div className="grid grid-cols-2 gap-2">
              {(['postgres', 'supabase', 'mysql', 'sqlite'] as const).map((engine) => {
                const supported = engine === 'postgres' || engine === 'supabase'
                return (
                  <button
                    key={engine}
                    disabled={!supported}
                    onClick={() => {
                      set('engine', engine)
                      set('port', DEFAULT_PORTS[engine] ?? 5432)
                    }}
                    className={cn(
                      'rounded border p-3 text-left transition-colors',
                      supported ? 'cursor-pointer hover:border-border-strong' : 'opacity-40',
                      form.engine === engine ? 'border-accent bg-accent/5' : 'border-border',
                    )}
                  >
                    <p className="text-sm font-medium capitalize">{engine}</p>
                    <p className="text-2xs text-subtle">
                      {supported ? 'Supported' : 'Connector not yet registered'}
                    </p>
                  </button>
                )
              })}
            </div>
          )}

          {step === 1 && (
            <>
              <Input
                label="Display name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Production analytics"
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input
                    label="Host"
                    value={form.host}
                    onChange={(e) => set('host', e.target.value)}
                  />
                </div>
                <Input
                  label="Port"
                  type="number"
                  value={form.port}
                  onChange={(e) => set('port', Number(e.target.value))}
                />
              </div>
              <Input
                label="Database"
                value={form.database_name}
                onChange={(e) => set('database_name', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Username"
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                />
                <Input
                  label="Password"
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label="SSL mode"
                  value={form.ssl_mode}
                  onChange={(e) => set('ssl_mode', e.target.value)}
                >
                  {['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Environment"
                  value={form.environment}
                  onChange={(e) => set('environment', e.target.value)}
                >
                  {['development', 'staging', 'production'].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.read_only}
                  onChange={(e) => set('read_only', e.target.checked)}
                  className="cursor-pointer"
                />
                Read-only mode
              </label>
              <p className="text-2xs text-subtle">
                Recommended. Use a database role that only has SELECT, so the restriction holds
                even if application checks are bypassed.
              </p>
              <Input
                label="Allowed schemas"
                value={form.allowed_schemas}
                onChange={(e) => set('allowed_schemas', e.target.value)}
                hint="Comma-separated. Queries naming any other schema are rejected."
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Query timeout (seconds)"
                  type="number"
                  value={form.query_timeout_seconds}
                  onChange={(e) => set('query_timeout_seconds', Number(e.target.value))}
                />
                <Input
                  label="Maximum rows"
                  type="number"
                  value={form.max_rows}
                  onChange={(e) => set('max_rows', Number(e.target.value))}
                />
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <Button variant="secondary" onClick={runTest} loading={busy}>
                <Plug className="h-3.5 w-3.5" aria-hidden /> Test connection
              </Button>
              {test && (
                <div
                  className={cn(
                    'rounded border p-3 text-xs',
                    test.ok
                      ? 'border-ok/30 bg-ok/5 text-fg'
                      : 'border-danger/30 bg-danger/5 text-fg',
                  )}
                >
                  <p className="font-medium">{test.message}</p>
                  {test.server_version && (
                    <p className="mt-1 font-mono text-2xs text-muted">{test.server_version}</p>
                  )}
                  {test.latency_ms != null && (
                    <p className="font-mono text-2xs text-muted">{test.latency_ms}ms</p>
                  )}
                  {test.is_read_only_role === false && (
                    <p className="mt-1 text-2xs text-warn">
                      This role can create objects. A dedicated read-only role is recommended.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              {!syncResult ? (
                <>
                  <p className="text-xs text-muted">
                    The schema is read once and cached, so questions do not pay for introspection.
                  </p>
                  <Button variant="primary" onClick={saveAndSync} loading={busy}>
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    Save and import schema
                  </Button>
                </>
              ) : (
                <div className="rounded border border-ok/30 bg-ok/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm text-fg">
                    <Check className="h-4 w-4 text-ok" aria-hidden /> Ready
                  </p>
                  <p className="mt-1 font-mono text-2xs text-muted">{syncResult}</p>
                </div>
              )}
            </div>
          )}

          {error && <ErrorState message={error} />}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && (!form.name || !form.database_name || !form.username)) ||
                (step === 3 && !test?.ok)
              }
            >
              Next
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onClose} disabled={!syncResult}>
              Done
            </Button>
          )}
        </footer>
      </div>
    </div>
  )
}
