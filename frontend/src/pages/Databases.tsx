/** Database list plus the multi-step connection wizard (spec section 10). */

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Database, Plug, RefreshCw, ShieldCheck, X } from 'lucide-react'

import { statusTone } from '@/components/layout/DatabaseSelector'
import {
  AsyncBoundary,
  Badge,
  Button,
  ConfirmDelete,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
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

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback
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
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <p className="micro">Connections</p>
            <h1 className="mt-0.5 text-lg font-medium text-fg">Databases</h1>
            <p className="mt-0.5 text-xs text-muted">
              Connections are stored with encrypted credentials and queried read-only.
            </p>
          </div>
          <Button variant="primary" onClick={() => setWizardOpen(true)}>
            <Plug className="h-3.5 w-3.5" aria-hidden /> Connect database
          </Button>
        </header>

        <AsyncBoundary
          isLoading={isLoading}
          isError={Boolean(error)}
          isEmpty={databases.length === 0}
          onRetry={() => void refetch()}
          errorMessage="Could not load databases."
          skeleton={
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          }
          empty={
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
          }
        >
          <ul className="space-y-2">
            {databases.map((db) => (
              <li key={db.id}>
                <ConnectionCard
                  db={db}
                  syncing={sync.isPending && sync.variables === db.id}
                  testing={test.isPending && test.variables === db.id}
                  removing={remove.isPending && remove.variables === db.id}
                  removeError={
                    remove.error && remove.variables === db.id
                      ? messageOf(remove.error, 'Could not remove this connection.')
                      : undefined
                  }
                  testResult={test.data && test.variables === db.id ? test.data : null}
                  onSelect={() => setDatabase(db.id)}
                  onSync={() => sync.mutate(db.id)}
                  onTest={() => test.mutate(db.id)}
                  onRemove={() => remove.mutate(db.id)}
                />
              </li>
            ))}
          </ul>
        </AsyncBoundary>
      </div>

      {wizardOpen && <ConnectionWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}

function ConnectionCard({
  db,
  syncing,
  testing,
  removing,
  removeError,
  testResult,
  onSelect,
  onSync,
  onTest,
  onRemove,
}: {
  db: DatabaseConnection
  syncing: boolean
  testing: boolean
  removing: boolean
  removeError?: string
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
              type="button"
              onClick={onSelect}
              className="cursor-pointer text-sm font-medium text-fg hover:text-accent"
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

          <p className="mt-1 truncate font-mono text-2xs tabular-nums text-subtle">
            {db.engine} · {db.username}@{db.host}:{db.port}/{db.database_name} ·{' '}
            {db.allowed_schemas.join(', ')}
          </p>

          <p className="mt-0.5 text-2xs tabular-nums text-muted">
            {db.last_synced_at
              ? `Schema synced ${formatRelative(db.last_synced_at)} · v${db.schema_version}`
              : 'Schema not synced yet'}
            {' · '}
            {db.max_rows.toLocaleString()} row cap · {db.query_timeout_seconds}s timeout
          </p>

          {db.last_error && <p className="mt-1 text-2xs text-danger">{db.last_error}</p>}

          {testResult && (
            <p className={cn('mt-1 text-2xs', testResult.ok ? 'text-ok' : 'text-danger')}>
              {testResult.message}
              {testResult.server_version && ` · ${testResult.server_version}`}
              {testResult.latency_ms != null && ` · ${testResult.latency_ms}ms`}
              {testResult.is_read_only_role === false &&
                ' · this role can write; a dedicated read-only role is recommended'}
            </p>
          )}
        </div>

        <div className="flex max-w-[15rem] shrink-0 flex-wrap items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onTest}
            loading={testing}
            title="Test connection"
            aria-label={`Test connection to ${db.name}`}
          >
            <Plug className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onSync}
            loading={syncing}
            title="Sync schema"
            aria-label={`Sync schema for ${db.name}`}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {/* One delete gesture for the whole app: confirm, show pending, show failure. */}
          <ConfirmDelete
            label={`Delete ${db.name}`}
            onConfirm={onRemove}
            pending={removing}
            error={removeError}
            confirming={confirming}
            setConfirming={setConfirming}
          />
        </div>
      </div>
    </div>
  )
}

const STEPS = ['Engine', 'Connection', 'Security', 'Test', 'Import'] as const

const FOCUSABLE =
  'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'

/**
 * Everything `aria-modal="true"` promises but does not implement: initial
 * focus, Escape to dismiss, a Tab loop that cannot leave the panel, and focus
 * returned to whatever opened the dialog.
 */
function useModalFocus(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)

  // The handler is installed once, on mount. Reading onClose through a ref is
  // what keeps it that way: if the effect depended on the prop it would tear
  // down and re-run on every parent render, yanking focus back to the close
  // button while the user was mid-field.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const opener = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) =>
          !el.hasAttribute('disabled') &&
          el.getAttribute('aria-hidden') !== 'true' &&
          (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement),
      )

    // Initial focus. The panel itself is the fallback so focus is never left
    // behind on the page underneath.
    ;(focusables()[0] ?? panel).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return

      const active = document.activeElement as HTMLElement | null
      const inside = active ? panel.contains(active) : false

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Restore focus to the trigger. A no-op if it has since unmounted.
      opener?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return panelRef
}

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

  const panelRef = useModalFocus(onClose)

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border border-border-strong bg-surface shadow-popover"
      >
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-elevated px-3">
          <h2 id="wizard-title" className="text-sm font-medium text-fg">
            Connect a database
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </header>

        <ol
          aria-label="Connection steps"
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2"
        >
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? 'step' : undefined}
              className="flex items-center gap-1"
            >
              <span
                className={cn(
                  'micro flex h-5 items-center gap-1 px-1.5',
                  i === step
                    ? 'bg-accent font-semibold text-accent-fg'
                    : i < step
                      ? 'text-ok'
                      : 'text-subtle',
                )}
              >
                {i < step && <Check className="h-2.5 w-2.5" aria-hidden />}
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="text-subtle" aria-hidden>
                  ·
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {step === 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(['postgres', 'supabase', 'mysql', 'sqlite'] as const).map((engine) => {
                const supported = engine === 'postgres' || engine === 'supabase'
                const selected = form.engine === engine
                return (
                  <button
                    type="button"
                    key={engine}
                    disabled={!supported}
                    aria-pressed={selected}
                    onClick={() => {
                      set('engine', engine)
                      set('port', DEFAULT_PORTS[engine] ?? 5432)
                    }}
                    className={cn(
                      'border p-3 text-left transition-colors',
                      supported ? 'cursor-pointer hover:border-border-strong' : 'opacity-40',
                      selected ? 'border-accent bg-accent/10' : 'border-border bg-surface',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium capitalize text-fg">{engine}</span>
                      {/* Selection is not colour alone: aria-pressed for AT, a tick for everyone. */}
                      {selected && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
                    </span>
                    <span className="mt-0.5 block text-2xs text-subtle">
                      {supported ? 'Supported' : 'Connector not yet registered'}
                    </span>
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="sm:col-span-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={form.read_only}
                  onChange={(e) => set('read_only', e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-accent"
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                    'border p-3 text-xs',
                    test.ok ? 'border-ok/35 bg-ok/5 text-fg' : 'border-danger/35 bg-danger/5 text-fg',
                  )}
                >
                  <p className="flex items-center gap-1.5 font-medium">
                    <StatusDot tone={test.ok ? 'ok' : 'danger'} />
                    {test.message}
                  </p>
                  {test.server_version && (
                    <p className="mt-1 font-mono text-2xs text-muted">{test.server_version}</p>
                  )}
                  {test.latency_ms != null && (
                    <p className="font-mono text-2xs tabular-nums text-muted">
                      {test.latency_ms}ms
                    </p>
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
                    Save and import schema
                  </Button>
                </>
              ) : (
                <div className="border border-ok/35 bg-ok/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm text-fg">
                    <Check className="h-4 w-4 text-ok" aria-hidden /> Ready
                  </p>
                  <p className="mt-1 font-mono text-2xs tabular-nums text-muted">{syncResult}</p>
                </div>
              )}
            </div>
          )}

          {error && <ErrorState message={error} />}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-border bg-elevated px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          <span className="micro tabular-nums">
            Step {step + 1} of {STEPS.length}
          </span>
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
