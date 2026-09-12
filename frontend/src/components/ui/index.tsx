/**
 * Primitives — "Instrument".
 *
 * Hand-written rather than pulled from a component CLI so the whole set is
 * visible, dependency-free, and consistent with the token palette.
 *
 * House rules, applied without exception below:
 *   - Square corners. Separation is a rule or a ground shift, never a shadow.
 *   - Every control has a visible focus ring and a real accessible name.
 *   - Labels are programmatically associated. A visible <label> that isn't
 *     wired to its field is a bug, not a style choice.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m, type HTMLMotionProps } from 'motion/react'
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'

import { PopIn, Reveal, Stagger, StaggerItem } from '@/components/motion'
import { DISTANCE, DURATION, EASE_OUT, SCALE, SPRING, usePrefersReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

// --- Button -----------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg border-accent hover:bg-accent/90 font-medium',
  secondary: 'bg-surface text-fg border-border-control hover:bg-elevated',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-elevated hover:text-fg',
  danger: 'bg-transparent text-danger border-danger/45 hover:bg-danger/10',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

/**
 * Press is a spring compress on every variant, so a click is felt the instant
 * it lands -- including from the keyboard, which Motion's press gesture
 * honours for Enter. Hover lift is reserved for filled buttons; a ghost icon
 * button in a dense toolbar that hopped under the cursor would be noise.
 * Motion's hover gesture ignores touch, so nothing sticks after a tap.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, children, disabled, ...props },
  ref,
) {
  const inert = Boolean(disabled || loading)
  return (
    <m.button
      ref={ref}
      disabled={inert}
      aria-busy={loading || undefined}
      whileHover={inert || variant === 'ghost' ? undefined : { y: -1 }}
      whileTap={inert ? undefined : { scale: SCALE.press }}
      transition={SPRING.press}
      className={cn(
        'relative inline-flex items-center justify-center border cursor-pointer',
        'transition-colors select-none whitespace-nowrap',
        'disabled:opacity-55 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      // The DOM handlers Motion redefines (onAnimationStart, onDrag*) are not
      // used by any caller; the rest pass straight through.
      {...(props as HTMLMotionProps<'button'>)}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </m.button>
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
  // useId is the last resort so a label is ALWAYS associated. Relying on
  // `props.name` alone silently unlabels every call site that omits it.
  const generated = useId()
  const inputId = id ?? props.name ?? generated
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`

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
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={cn(
          'field',
          error && 'border-danger focus:border-danger focus:ring-danger',
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
})

// --- Select -----------------------------------------------------------------

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, className, children, id, ...props },
  ref,
) {
  const generated = useId()
  const selectId = id ?? props.name ?? generated

  return (
    <div className="w-full">
      {label && (
        <label className="label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select ref={ref} id={selectId} className={cn('field cursor-pointer', className)} {...props}>
        {children}
      </select>
    </div>
  )
})

// --- Badge ------------------------------------------------------------------

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'bg-elevated text-muted border-border-strong',
  ok: 'bg-ok/10 text-ok border-ok/35',
  warn: 'bg-warn/10 text-warn border-warn/35',
  danger: 'bg-danger/10 text-danger border-danger/35',
  info: 'bg-info/10 text-info border-info/35',
  accent: 'bg-accent/10 text-accent border-accent/35',
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
        'inline-flex items-center gap-1 border px-1.5 py-px text-2xs font-medium',
        'uppercase tracking-[0.07em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

const DOT_COLOR: Record<Tone, string> = {
  neutral: 'bg-subtle',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
}

/**
 * Small status dot; always pairs with a text label rather than replacing it.
 * When the status changes while on screen -- a test turns a pending
 * connection green -- one ring expands off it. Never on first render: a page
 * of dots all pinging at once would say nothing.
 */
export function StatusDot({ tone = 'neutral' }: { tone?: Tone }) {
  const previous = useRef(tone)
  const [ping, setPing] = useState(0)

  useEffect(() => {
    if (previous.current === tone) return
    previous.current = tone
    setPing((n) => n + 1)
  }, [tone])

  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
      {ping > 0 && (
        <span
          key={ping}
          className={cn('absolute inset-0 rounded-full animate-ping-once', DOT_COLOR[tone])}
        />
      )}
      <span
        className={cn(
          'relative h-1.5 w-1.5 rounded-full transition-colors duration-base',
          DOT_COLOR[tone],
        )}
      />
    </span>
  )
}

// --- Feedback ---------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} aria-hidden />
}

/**
 * A full-area wait. The spinner holds back for a moment before appearing, so
 * a load that resolves quickly shows nothing at all instead of a flash.
 */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex h-full items-center justify-center gap-2 text-sm text-muted', className)}
    >
      <span className="flex items-center gap-2 animate-fade-in-delayed">
        <Spinner className="h-5 w-5" />
        {label && <span>{label}</span>}
      </span>
      {!label && <span className="sr-only">Loading</span>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-elevated', className)} aria-hidden />
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
  // Icon, then title, then the explanation and the way out: the order a
  // reader needs them in.
  return (
    <Stagger className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <StaggerItem index={0} variant="fade" className="mb-3 text-subtle">
          {icon}
        </StaggerItem>
      )}
      <StaggerItem as="h3" index={1} className="text-sm font-medium text-fg">
        {title}
      </StaggerItem>
      {description && (
        <StaggerItem as="p" index={2} className="mt-1 max-w-sm text-xs text-muted">
          {description}
        </StaggerItem>
      )}
      {action && (
        <StaggerItem index={3} className="mt-4">
          {action}
        </StaggerItem>
      )}
    </Stagger>
  )
}

/**
 * Inline failure. Arrives with a short lift and the icon settling in; no
 * shake, because an error the user did not cause is not a scolding. The
 * message is the content -- the motion only draws the eye to it.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Reveal
      role="alert"
      className="flex items-start gap-2.5 border border-danger/40 bg-danger/5 p-3"
    >
      <PopIn className="mt-0.5 shrink-0">
        <AlertCircle className="h-4 w-4 text-danger" aria-hidden />
      </PopIn>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg">{message}</p>
        {onRetry && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </Reveal>
  )
}

/**
 * The counterpart to ErrorState, same shape and spacing. Confirmation is
 * rendered rather than flashed so it survives a re-render and is still there
 * for anyone who looks away -- and role="status" announces it once without
 * stealing focus.
 */
export function SuccessState({
  message,
  details,
  onDismiss,
}: {
  message: string
  details?: ReactNode
  onDismiss?: () => void
}) {
  return (
    <Reveal role="status" className="flex items-start gap-2.5 border border-ok/40 bg-ok/5 p-3">
      <PopIn className="mt-0.5 shrink-0">
        <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden />
      </PopIn>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg">{message}</p>
        {details && <div className="mt-1 text-2xs text-muted">{details}</div>}
      </div>
      {onDismiss && (
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
          <X className="h-3 w-3" aria-hidden />
        </Button>
      )}
    </Reveal>
  )
}

/**
 * Async surface in one place: an error beats an empty state, an empty state
 * beats rendering nothing. Using this everywhere is what stops a failed
 * request from being presented as a legitimate zero.
 */
export function AsyncBoundary({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  errorMessage = 'Could not load this.',
  empty,
  skeleton,
  children,
}: {
  isLoading?: boolean
  isError?: boolean
  isEmpty?: boolean
  onRetry?: () => void
  errorMessage?: string
  empty?: ReactNode
  skeleton?: ReactNode
  children: ReactNode
}) {
  if (isError) return <ErrorState message={errorMessage} onRetry={onRetry} />
  if (isLoading) return <>{skeleton ?? <Skeleton className="h-24 w-full" />}</>
  if (isEmpty && empty) return <>{empty}</>
  return <>{children}</>
}

// --- Layout helpers ---------------------------------------------------------

/**
 * A titled region. Pass `index` to have it arrive as part of its page's
 * sequence (`when="inView"` for panels below the fold); without it the panel
 * simply renders, which is right inside dialogs and disclosures that already
 * animate themselves.
 */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  index,
  when,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  index?: number
  when?: 'mount' | 'inView'
}) {
  const content = (
    <>
      {(title || actions) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-border bg-elevated px-3">
          <h2 className="micro truncate text-muted">{title}</h2>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </>
  )
  const classes = cn('panel flex flex-col overflow-hidden', className)

  if (index === undefined) return <section className={classes}>{content}</section>
  return (
    <Reveal as="section" index={index} when={when} className={classes}>
      {content}
    </Reveal>
  )
}

/**
 * Stat tile for the dashboard and analytics pages. `index` places it in its
 * row's stagger. The figure is never counted up from zero: an animation that
 * passes through numbers the data never had would misreport it, however
 * briefly, and a screen reader could catch it mid-count.
 */
export function Stat({
  label,
  value,
  sub,
  tone,
  index = 0,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  index?: number
}) {
  return (
    <Reveal index={index} className="panel px-3.5 py-3">
      <p className="micro">{label}</p>
      <p
        className={cn(
          'mt-1.5 font-mono text-2xl tabular-nums text-fg transition-colors duration-base',
          tone === 'danger' && 'text-danger',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-2xs text-muted">{sub}</p>}
    </Reveal>
  )
}

/**
 * Two-step destructive confirm, so delete gestures are identical everywhere.
 * Shows pending, and surfaces failure instead of appearing to do nothing.
 */
export function ConfirmDelete({
  onConfirm,
  label,
  pending,
  error,
  confirming,
  setConfirming,
}: {
  onConfirm: () => void
  label: string
  pending?: boolean
  error?: string
  confirming: boolean
  setConfirming: (v: boolean) => void
}) {
  const reduced = usePrefersReducedMotion()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  // Which control the swap should hand focus to. Without this the button the
  // user just activated unmounts under them and focus falls to <body>.
  const focusNext = useRef<'cancel' | 'delete' | null>(null)

  useEffect(() => {
    const target = focusNext.current === 'cancel' ? cancelRef : focusNext.current === 'delete' ? deleteRef : null
    focusNext.current = null
    target?.current?.focus()
  }, [confirming])

  const swap = {
    initial: reduced ? false : ({ opacity: 0, x: DISTANCE.nudge * 2 } as const),
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, transition: { duration: reduced ? 0 : DURATION.instant } },
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {!confirming ? (
        <m.span key="delete" className="inline-flex" {...swap}>
          <Button
            ref={deleteRef}
            size="sm"
            variant="ghost"
            aria-label={label}
            onClick={() => {
              focusNext.current = 'cancel'
              setConfirming(true)
            }}
          >
            Delete
          </Button>
        </m.span>
      ) : (
        // Focus lands on Cancel, not Confirm: a stray second Enter should
        // back out of a delete, never complete one.
        <m.div key="confirm" className="flex items-center gap-1" {...swap}>
          {error && <span className="mr-1 text-2xs text-danger">{error}</span>}
          <Button size="sm" variant="danger" loading={pending} onClick={onConfirm}>
            Confirm
          </Button>
          <Button
            ref={cancelRef}
            size="sm"
            variant="ghost"
            aria-label="Cancel delete"
            onClick={() => {
              focusNext.current = 'delete'
              setConfirming(false)
            }}
          >
            Cancel
          </Button>
        </m.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Full-surface failure, as opposed to ErrorState's inline strip. Used for the
 * cases where there is no partial page worth showing: an unknown route, a
 * render that threw, a session that cannot be established, a page the user is
 * not allowed to see.
 */
export function ErrorPage({
  code,
  title,
  description,
  actions,
  icon,
  detail,
}: {
  code?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  detail?: string
}) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-[60vh] items-center justify-center px-4 py-10"
    >
      {/* What happened reads first; the way out follows it. */}
      <Stagger className="w-full max-w-md text-center">
        {icon && (
          <StaggerItem index={0} variant="fade" className="mb-3 flex justify-center text-subtle">
            {icon}
          </StaggerItem>
        )}
        {code && (
          <StaggerItem as="p" index={0} className="micro">
            {code}
          </StaggerItem>
        )}
        <StaggerItem as="h1" index={1} className="mt-1.5 text-lg font-medium text-fg">
          {title}
        </StaggerItem>
        {description && (
          <StaggerItem
            as="p"
            index={2}
            className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted"
          >
            {description}
          </StaggerItem>
        )}
        {actions && (
          <StaggerItem index={3} className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </StaggerItem>
        )}
        {/* Development only. A stack trace is not a user-facing artefact. */}
        {detail && import.meta.env.DEV && (
          <pre className="mt-5 max-h-40 overflow-auto border border-border bg-elevated p-2 text-left font-mono text-2xs text-muted">
            {detail}
          </pre>
        )}
      </Stagger>
    </div>
  )
}

/**
 * The shared entrance for modal surfaces: the scrim fades, the panel rises a
 * few pixels and settles. Enter-only -- dialogs here are unmounted by their
 * callers, and a closing animation is time the user spends waiting.
 *
 * Portalled to <body>. A dialog rendered inside a card that lifts on hover, or
 * a page mid-transition, would otherwise be positioned against that transform
 * instead of the viewport.
 */
export function ModalLayer({
  children,
  className,
  onBackdropClick,
}: {
  children: ReactNode
  className?: string
  onBackdropClick: () => void
}) {
  const reduced = usePrefersReducedMotion()
  return createPortal(
    <m.div
      className={cn('fixed inset-0 flex items-center justify-center bg-scrim/50 p-4', className)}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      onClick={(e) => e.target === e.currentTarget && onBackdropClick()}
    >
      {children}
    </m.div>,
    document.body,
  )
}

export const MODAL_PANEL_MOTION = {
  initial: { opacity: 0, y: DISTANCE.lift, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

// --- Dialogs ----------------------------------------------------------------

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'

/**
 * Everything `aria-modal="true"` promises but does not implement: initial
 * focus, Escape to dismiss, a Tab loop that cannot leave the panel, and focus
 * returned to whatever opened the dialog.
 *
 * Nesting note: listeners are registered on `document` in the capture phase,
 * so for two open dialogs the outer one's handler runs first. `stopPropagation`
 * does not silence a second listener on the same target, so an inner dialog
 * still sees Escape -- the outer dialog is responsible for ignoring Escape
 * while it has a child dialog on screen.
 */
export function useModalFocus(onClose: () => void) {
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

/**
 * One confirmation gesture for the whole app, so "are you sure" looks and
 * behaves identically wherever it appears. Sits at z-60 so it can open on top
 * of the connection wizard at z-50.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  pending?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const panelRef = useModalFocus(onCancel)
  const titleId = useId()
  const descriptionId = useId()
  const reduced = usePrefersReducedMotion()

  return (
    <ModalLayer className="z-[60]" onBackdropClick={() => !pending && onCancel()}>
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="w-full max-w-sm border border-border-strong bg-surface shadow-popover"
        {...MODAL_PANEL_MOTION}
        initial={reduced ? false : MODAL_PANEL_MOTION.initial}
      >
        <header className="flex h-10 shrink-0 items-center border-b border-border bg-elevated px-3">
          <h2 id={titleId} className="text-sm font-medium text-fg">
            {title}
          </h2>
        </header>
        <div className="space-y-3 p-4">
          {description && (
            <div id={descriptionId} className="text-xs leading-relaxed text-muted">
              {description}
            </div>
          )}
          {error && <ErrorState message={error} />}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button variant={tone} loading={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </m.div>
    </ModalLayer>
  )
}
