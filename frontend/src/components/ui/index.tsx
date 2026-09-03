/**
 * Primitives.
 *
 * Hand-written rather than pulled from a component CLI so the whole set is
 * visible, dependency-free, and consistent with the token palette. Every
 * interactive element carries a visible focus ring and cursor-pointer.
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

// --- Button -----------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 border-transparent font-medium',
  secondary: 'bg-surface text-fg border-border hover:bg-elevated',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-elevated hover:text-fg',
  danger: 'bg-transparent text-danger border-border hover:bg-danger/10',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded border cursor-pointer',
        'transition-colors select-none whitespace-nowrap',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

// --- Input ------------------------------------------------------------------

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const inputId = id ?? props.name
  return (
    <div className="w-full">
      {label && (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={cn('field', error && 'border-danger focus:border-danger focus:ring-danger', className)}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
})

// --- Select -----------------------------------------------------------------

export function Select({
  label,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className="w-full">
      {label && <label className="label">{label}</label>}
      <select className={cn('field cursor-pointer', className)} {...props}>
        {children}
      </select>
    </div>
  )
}

// --- Badge ------------------------------------------------------------------

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'bg-elevated text-muted border-border',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  info: 'bg-info/10 text-info border-info/25',
  accent: 'bg-accent/10 text-accent border-accent/25',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Small status dot; pairs with a text label rather than replacing it. */
export function StatusDot({ tone = 'neutral' }: { tone?: Tone }) {
  const color: Record<Tone, string> = {
    neutral: 'bg-subtle',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
    accent: 'bg-accent',
  }
  return <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', color[tone])} aria-hidden />
}

// --- Feedback ---------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} aria-hidden />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-elevated', className)} aria-hidden />
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      {icon && <div className="mb-3 text-subtle">{icon}</div>}
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded border border-danger/30 bg-danger/5 p-3"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg">{message}</p>
        {onRetry && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

// --- Layout helpers ---------------------------------------------------------

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('panel flex flex-col overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
          <h2 className="truncate text-xs font-medium text-fg">{title}</h2>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Stat tile for the dashboard and analytics pages. */
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="panel px-3.5 py-3">
      <p className="text-2xs uppercase tracking-wide text-subtle">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-xl tabular-nums text-fg',
          tone === 'danger' && 'text-danger',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-2xs text-muted">{sub}</p>}
    </div>
  )
}
