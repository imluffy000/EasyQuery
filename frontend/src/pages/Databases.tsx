/** Database list plus the multi-step connection wizard (spec section 10). */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { m } from 'motion/react'
import { Check, Database, Loader2, Plug, RefreshCw, ShieldCheck, X } from 'lucide-react'

import { statusTone } from '@/components/layout/DatabaseSelector'
import { PopIn, Reveal, Stagger, StaggerItem, SwapText } from '@/components/motion'
import {
  AsyncBoundary,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  MODAL_PANEL_MOTION,
  ModalLayer,
  Select,
  Skeleton,
  StatusDot,
  SuccessState,
  useModalFocus,
} from '@/components/ui'
import { ApiRequestError, api } from '@/lib/api'
import { DISTANCE, DURATION, EASE_OUT, useFlash, usePrefersReducedMotion } from '@/lib/motion'
import { useRequestLeave, useUnsavedGuard } from '@/lib/unsavedChanges'
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

/**
 * A connection the backend already tells us is a duplicate. The endpoint
 * answers 409 with DATABASE_EXISTS; the status check is the fallback for any
 * other conflict so the message stays accurate either way.
 */
function isDuplicate(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.code === 'DATABASE_EXISTS' || err.status === 409)
}

interface ConnectionForm {
  name: string
  engine: string
  environment: string
  host: string
  port: number
  database_name: string
  username: string
  password: string
  ssl_mode: string
  read_only: boolean
  allowed_schemas: string
  query_timeout_seconds: number
  max_rows: number
}

type FieldErrors = Partial<Record<keyof ConnectionForm, string>>

/**
 * Required-field validation, so obviously incomplete details are not spent on
 * a network round trip and a connection timeout. Networked engines need a
 * host and credentials; a file-backed engine does not, which is why this is
 * keyed off the engine rather than applied flatly.
 */
function validateForm(form: ConnectionForm): FieldErrors {
  const errors: FieldErrors = {}
  const networked = form.engine !== 'sqlite'

  if (!form.name.trim()) errors.name = 'Enter a name for this connection.'
  if (!form.database_name.trim()) errors.database_name = 'Enter the database name.'

  if (networked) {
    if (!form.host.trim()) errors.host = 'Enter a host.'
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.port = 'Enter a port between 1 and 65535.'
    }
    if (!form.username.trim()) errors.username = 'Enter a username.'
    if (!form.password) errors.password = 'Enter a password.'
  }

  if (form.allowed_schemas.split(',').every((s) => !s.trim())) {
    errors.allowed_schemas = 'Name at least one schema.'
  }
  const timeout = Number(form.query_timeout_seconds)
  if (!Number.isInteger(timeout) || timeout < 1) {
    errors.query_timeout_seconds = 'Enter a timeout of at least 1 second.'
  }
  const maxRows = Number(form.max_rows)
  if (!Number.isInteger(maxRows) || maxRows < 1) errors.max_rows = 'Enter a row cap of at least 1.'

  return errors
}

const INITIAL_FORM: ConnectionForm = {
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
}

const FORM_KEYS = Object.keys(INITIAL_FORM) as (keyof ConnectionForm)[]

/** Nothing typed yet, so closing the wizard would discard nothing. */
function isPristine(form: ConnectionForm): boolean {
  return FORM_KEYS.every((key) => form[key] === INITIAL_FORM[key])
}

/** Fields each wizard step is responsible for, so Next only blocks on its own. */
const STEP_FIELDS: Record<number, (keyof ConnectionForm)[]> = {
  1: ['name', 'host', 'port', 'database_name', 'username', 'password'],
  2: ['allowed_schemas', 'query_timeout_seconds', 'max_rows'],
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

  // Feedback for actions whose own row disappears or does not visibly change
  // when they succeed.
  const [notice, setNotice] = useState<{ message: string; details?: string } | null>(null)

  const sync = useMutation({
    mutationFn: (id: string) => api.databases.sync(workspaceId!, id),
    onSuccess: (result) => {
      setNotice({
        message: 'Schema refreshed successfully.',
        details: `${result.tables} tables, ${result.columns} columns imported.`,
      })
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
    onSuccess: () => {
      setNotice({
        message: 'Database connection removed.',
        details: 'The external database itself was not changed.',
      })
      queryClient.invalidateQueries({ queryKey: ['databases'] })
    },
  })

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <Reveal
          as="header"
          className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"
        >
          <div>
            <p className="micro">Connections</p>
            <h1 className="mt-0.5 text-lg font-medium text-fg">Databases</h1>
            <p className="mt-0.5 text-xs text-muted">
              Connections are stored with encrypted credentials and queried read-only.
            </p>
          </div>
          <Button variant="primary" className="group" onClick={() => setWizardOpen(true)}>
            <Plug
              className="h-3.5 w-3.5 transition-transform duration-base motion-safe:group-hover:rotate-12"
              aria-hidden
            />{' '}
            Connect database
          </Button>
        </Reveal>

        {notice && (
          <div className="mb-3">
            <SuccessState
              message={notice.message}
              details={notice.details}
              onDismiss={() => setNotice(null)}
            />
          </div>
        )}

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
          <Stagger as="ul" className="space-y-2">
            {databases.map((db, i) => (
              <StaggerItem as="li" key={db.id} index={i}>
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
                  onSync={(done) => sync.mutate(db.id, { onSettled: (_data, err) => done(!err) })}
                  onTest={(done) =>
                    test.mutate(db.id, { onSettled: (data, err) => done(Boolean(data?.ok) && !err) })
                  }
                  onRemove={() => remove.mutate(db.id)}
                />
              </StaggerItem>
            ))}
          </Stagger>
        </AsyncBoundary>
      </div>

      {wizardOpen && (
        <ConnectionWizard
          onClose={() => setWizardOpen(false)}
          onAdded={(message, details) => setNotice({ message, details })}
        />
      )}
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
  /** Each reports back whether the operation succeeded, for the button's own confirmation. */
  onSync: (done: (ok: boolean) => void) => void
  onTest: (done: (ok: boolean) => void) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  // The icon on each action settles into the outcome for a moment: a tick when
  // the server confirmed it, a cross when it did not. The written result below
  // the card stays; this is only the at-a-glance echo on the control itself.
  const [testOutcome, flashTest] = useFlash<'ok' | 'fail'>(1800)
  const [syncOutcome, flashSync] = useFlash<'ok' | 'fail'>(1800)

  return (
    <div className="lift panel p-3">
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
            // Keyed by the outcome so a re-test that changes the answer
            // arrives visibly rather than overwriting the line in place.
            <Reveal
              as="p"
              variant="fade"
              key={`${testResult.ok}-${testResult.message}-${testResult.latency_ms}`}
              className={cn('mt-1 text-2xs', testResult.ok ? 'text-ok' : 'text-danger')}
            >
              {testResult.message}
              {testResult.server_version && ` · ${testResult.server_version}`}
              {testResult.latency_ms != null && ` · ${testResult.latency_ms}ms`}
              {testResult.is_read_only_role === false &&
                ' · this role can write; a dedicated read-only role is recommended'}
            </Reveal>
          )}
        </div>

        <div className="flex max-w-[15rem] shrink-0 flex-wrap items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onTest((ok) => flashTest(ok ? 'ok' : 'fail'))}
            disabled={testing}
            aria-busy={testing || undefined}
            title="Test connection"
            aria-label={`Test connection to ${db.name}`}
          >
            <ActionIcon busy={testing} outcome={testOutcome} icon={<Plug className="h-3.5 w-3.5" aria-hidden />} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSync((ok) => flashSync(ok ? 'ok' : 'fail'))}
            disabled={syncing}
            aria-busy={syncing || undefined}
            title="Sync schema"
            aria-label={`Sync schema for ${db.name}`}
          >
            {/* The refresh glyph itself turns while syncing: the icon already
                means "refresh", so spinning it says "refreshing" without a
                second, unrelated spinner beside it. */}
            <ActionIcon
              busy={false}
              outcome={syncOutcome}
              icon={
                <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} aria-hidden />
              }
            />
          </Button>
          {/* Removing a connection is confirmed in a dialog rather than inline,
              because the reassurance that the external database is untouched
              is the whole point and does not fit on a button. */}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${db.name}`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Remove this database connection?"
          description={
            <>
              This will remove <span className="font-medium text-fg">{db.name}</span> from your
              EasyQuery account, along with its imported schema. It will not delete the actual
              external database, and no data in it is changed.
            </>
          }
          confirmLabel="Remove"
          cancelLabel="Cancel"
          tone="danger"
          pending={removing}
          error={removeError}
          onConfirm={onRemove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

/**
 * An icon-only action's three looks: its glyph at rest, a spinner while the
 * request runs, then the outcome for a moment. The button's aria-label names
 * the action; the outcome is spoken by the written result it produces.
 */
function ActionIcon({
  busy,
  outcome,
  icon,
}: {
  busy: boolean
  outcome: 'ok' | 'fail' | null
  icon: React.ReactNode
}) {
  const state = busy ? 'busy' : (outcome ?? 'idle')
  return (
    <SwapText state={state}>
      {state === 'busy' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : state === 'ok' ? (
        <PopIn>
          <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
        </PopIn>
      ) : state === 'fail' ? (
        <PopIn>
          <X className="h-3.5 w-3.5 text-danger" aria-hidden />
        </PopIn>
      ) : (
        icon
      )}
    </SwapText>
  )
}

const STEPS = ['Engine', 'Connection', 'Security', 'Test', 'Import'] as const

function ConnectionWizard({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: (message: string, details?: string) => void
}) {
  const workspaceId = useAppStore((s) => s.workspaceId)
  const setDatabase = useAppStore((s) => s.setDatabase)
  const queryClient = useQueryClient()

  const [step, setStep] = useState(0)
  // Which way the last step change went, so the next step's content enters
  // from the side the user is moving toward.
  const [direction, setDirection] = useState<1 | -1>(1)
  const goTo = (next: number) => {
    setDirection(next < step ? -1 : 1)
    setStep(next)
  }
  const reduced = usePrefersReducedMotion()
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const [created, setCreated] = useState<DatabaseConnection | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Validation messages appear once a step has been submitted, not while the
  // user is still filling in the first field of it.
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})

  const [form, setForm] = useState<ConnectionForm>(INITIAL_FORM)

  // Typed-in connection details are unsaved work until the connection is
  // actually created; after that there is nothing left to lose.
  const dirty = !created && !isPristine(form)
  useUnsavedGuard('database-wizard', dirty)
  const requestLeave = useRequestLeave()

  // Escape reaches the wizard before the confirmation dialog it opened, so
  // asking again here would immediately re-open it; requestLeave is a no-op
  // when nothing is dirty, which is the case once the connection is saved.
  const requestClose = () => requestLeave(onClose)

  const panelRef = useModalFocus(requestClose)

  const errors = validateForm(form)
  const stepErrors = (index: number): boolean =>
    (STEP_FIELDS[index] ?? []).some((field) => errors[field])
  const fieldError = (field: keyof ConnectionForm): string | undefined =>
    attempted[step] ? errors[field] : undefined

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

  /** Guard both network calls, so incomplete details never reach the wire. */
  const blockedByValidation = (): boolean => {
    const incomplete = FORM_KEYS.some((field) => errors[field])
    if (!incomplete) return false
    setAttempted((prev) => ({ ...prev, 1: true, 2: true }))
    setError('Some connection details are missing or invalid. Check the earlier steps.')
    return true
  }

  const runTest = async () => {
    if (busy || blockedByValidation()) return
    setBusy(true)
    setError(null)
    setTest(null)
    try {
      setTest(await api.databases.testNew(workspaceId!, payload()))
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Unable to connect to the database. Please check your connection details and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const saveAndSync = async () => {
    if (busy || blockedByValidation()) return
    setBusy(true)
    setError(null)
    try {
      const connection = created ?? (await api.databases.create(workspaceId!, payload()))
      setCreated(connection)
      const result = await api.databases.sync(workspaceId!, connection.id)
      setSyncResult(`${result.tables} tables, ${result.columns} columns`)
      setDatabase(connection.id)
      onAdded(
        'Database added successfully.',
        `${connection.engine} · ${connection.name} · ${result.tables} tables imported.`,
      )
      queryClient.invalidateQueries({ queryKey: ['databases'] })
      queryClient.invalidateQueries({ queryKey: ['schema'] })
    } catch (err) {
      // The same identity already exists, which is a duplicate rather than a
      // failure -- say so instead of offering "try again".
      setError(
        isDuplicate(err)
          ? 'This database connection already exists. Close this wizard to see it in the list.'
          : messageOf(err, 'Could not save the connection. Please try again.'),
      )
    } finally {
      setBusy(false)
    }
  }

  // Idle -> Connecting -> Connected, or Connecting -> failed -> Retry. The
  // label is the state in words; the written result below carries the detail.
  const testState = busy && step === 3 ? 'connecting' : test?.ok ? 'connected' : test || (error && step === 3) ? 'retry' : 'idle'

  return (
    <ModalLayer className="z-50" onBackdropClick={requestClose}>
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border border-border-strong bg-surface shadow-popover"
        {...MODAL_PANEL_MOTION}
        initial={reduced ? false : MODAL_PANEL_MOTION.initial}
      >
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-elevated px-3">
          <h2 id="wizard-title" className="text-sm font-medium text-fg">
            Connect a database
          </h2>
          <Button size="sm" variant="ghost" onClick={requestClose} aria-label="Close">
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
                  'micro flex h-5 items-center gap-1 px-1.5 transition-colors duration-base',
                  i === step
                    ? 'bg-accent font-semibold text-accent-fg'
                    : i < step
                      ? 'text-ok'
                      : 'text-subtle',
                )}
              >
                {i < step && (
                  <PopIn>
                    <Check className="h-2.5 w-2.5" aria-hidden />
                  </PopIn>
                )}
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-4">
          {/* Keyed by step: the new step's fields slide in from the direction
              of travel. Enter only, so Next and Back respond immediately. */}
          <m.div
            key={step}
            className="space-y-3"
            initial={reduced ? false : { opacity: 0, x: direction * DISTANCE.lift * 1.5 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          >
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
                        'border p-3 text-left',
                        supported ? 'lift cursor-pointer hover:border-border-strong' : 'opacity-40',
                        selected ? 'border-accent bg-accent/10' : 'border-border bg-surface',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium capitalize text-fg">{engine}</span>
                        {/* Selection is not colour alone: aria-pressed for AT, a tick for everyone. */}
                        {selected && (
                          <PopIn>
                            <Check className="h-3.5 w-3.5 text-accent" aria-hidden />
                          </PopIn>
                        )}
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
                  error={fieldError('name')}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Input
                      label="Host"
                      value={form.host}
                      onChange={(e) => set('host', e.target.value)}
                      error={fieldError('host')}
                    />
                  </div>
                  <Input
                    label="Port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => set('port', Number(e.target.value))}
                    error={fieldError('port')}
                  />
                </div>
                <Input
                  label="Database"
                  value={form.database_name}
                  onChange={(e) => set('database_name', e.target.value)}
                  error={fieldError('database_name')}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    label="Username"
                    value={form.username}
                    onChange={(e) => set('username', e.target.value)}
                    error={fieldError('username')}
                  />
                  <Input
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    error={fieldError('password')}
                    hint={fieldError('password') ? undefined : 'Encrypted before it is stored.'}
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
                  error={fieldError('allowed_schemas')}
                  hint="Comma-separated. Queries naming any other schema are rejected."
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    label="Query timeout (seconds)"
                    type="number"
                    min={1}
                    value={form.query_timeout_seconds}
                    onChange={(e) => set('query_timeout_seconds', Number(e.target.value))}
                    error={fieldError('query_timeout_seconds')}
                  />
                  <Input
                    label="Maximum rows"
                    type="number"
                    min={1}
                    value={form.max_rows}
                    onChange={(e) => set('max_rows', Number(e.target.value))}
                    error={fieldError('max_rows')}
                  />
                </div>
              </>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <Button variant="secondary" onClick={runTest} disabled={busy} aria-busy={busy || undefined}>
                  <SwapText state={testState}>
                    {testState === 'connecting' ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Connecting...
                      </>
                    ) : testState === 'connected' ? (
                      <>
                        <PopIn>
                          <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
                        </PopIn>{' '}
                        Connected
                      </>
                    ) : testState === 'retry' ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry connection
                      </>
                    ) : (
                      <>
                        <Plug className="h-3.5 w-3.5" aria-hidden /> Test connection
                      </>
                    )}
                  </SwapText>
                </Button>
                {/* Only non-sensitive facts are echoed back: engine, name, server
                    version and latency. Never the password or a full DSN. */}
                {test?.ok && (
                  <SuccessState
                    message="Database connected successfully."
                    details={
                      <>
                        <span className="capitalize">{form.engine}</span> · {form.database_name} ·
                        connected
                        {test.server_version && (
                          <span className="mt-0.5 block font-mono">{test.server_version}</span>
                        )}
                        {test.latency_ms != null && (
                          <span className="block font-mono tabular-nums">{test.latency_ms}ms</span>
                        )}
                        {test.is_read_only_role === false && (
                          <span className="mt-1 block text-warn">
                            This role can create objects. A dedicated read-only role is recommended.
                          </span>
                        )}
                      </>
                    }
                  />
                )}
                {/* No retry button of its own: the test button directly above
                    has already turned into "Retry connection". */}
                {test && !test.ok && (
                  <ErrorState
                    message={
                      test.message ||
                      'Unable to connect to the database. Please check your connection details and try again.'
                    }
                  />
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
                    {/* Saved is not a label here: on success the button gives way
                        to the confirmation below, which names what was imported. */}
                    <Button variant="primary" onClick={saveAndSync} loading={busy}>
                      <SwapText state={busy ? 'saving' : 'idle'}>
                        {busy ? 'Saving...' : 'Save and import schema'}
                      </SwapText>
                    </Button>
                  </>
                ) : (
                  <SuccessState
                    message="Database added successfully."
                    details={
                      <>
                        <span className="capitalize">{created?.engine ?? form.engine}</span> ·{' '}
                        {created?.name ?? form.name} · connected
                        <span className="mt-0.5 block font-mono tabular-nums">{syncResult}</span>
                      </>
                    }
                  />
                )}
              </div>
            )}
          </m.div>

          {error && <ErrorState message={error} />}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-border bg-elevated px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => goTo(Math.max(0, step - 1))}
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
              // Steps with fields stay clickable and reveal what is missing; a
              // disabled button with no explanation is the worse failure.
              onClick={() => {
                if (stepErrors(step)) {
                  setAttempted((prev) => ({ ...prev, [step]: true }))
                  return
                }
                setError(null)
                goTo(step + 1)
              }}
              disabled={step === 3 && !test?.ok}
            >
              Next
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onClose} disabled={!syncResult}>
              Done
            </Button>
          )}
        </footer>
      </m.div>
    </ModalLayer>
  )
}
