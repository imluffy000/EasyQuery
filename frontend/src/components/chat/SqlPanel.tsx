/**
 * SQL viewer and query details.
 *
 * Generated SQL and executed SQL are shown as separate tabs, never conflated:
 * the guard rewrites statements (it injects LIMIT), and the user is entitled
 * to see exactly what ran (spec section 4).
 */

import { useEffect, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import { Check, Copy, X } from 'lucide-react'

import { Badge, Button } from '@/components/ui'
import { cn, formatDuration, formatNumber } from '@/lib/utils'
import type { ChatResponse } from '@/types/api'

export function SqlViewer({
  sql,
  height = 160,
  onChange,
  readOnly = true,
  ariaLabel = 'SQL',
}: {
  sql: string
  height?: number
  onChange?: (value: string) => void
  readOnly?: boolean
  ariaLabel?: string
}) {
  // Monaco's stock vs-dark is a neutral grey (#1e1e1e) that reads as a colder
  // surface than every panel around it. Paint the editor from the same tokens
  // as the rest of the app, and re-read them when the theme changes.
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const defineTheme = (monaco: Monaco) => {
    const css = getComputedStyle(document.documentElement)
    const hex = (name: string) => {
      const [r, g, b] = css.getPropertyValue(name).trim().split(/\s+/).map(Number)
      return `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, '0')).join('')}`
    }
    monaco.editor.defineTheme('instrument', {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': hex('--surface'),
        'editor.foreground': hex('--fg'),
        'editorLineNumber.foreground': hex('--subtle'),
        'editorLineNumber.activeForeground': hex('--muted'),
        'editor.lineHighlightBackground': hex('--elevated'),
        'editorGutter.background': hex('--surface'),
        'editorCursor.foreground': hex('--accent'),
      },
    })
    monaco.editor.setTheme('instrument')
  }

  return (
    <Editor
      height={height}
      language="sql"
      value={sql}
      theme={dark ? 'vs-dark' : 'vs'}
      beforeMount={defineTheme}
      onChange={(v) => onChange?.(v ?? '')}
      options={{
        readOnly,
        ariaLabel,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: '"Fira Code", monospace',
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        renderLineHighlight: readOnly ? 'none' : 'line',
        wordWrap: 'on',
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        overviewRulerLanes: 0,
        folding: false,
      }}
    />
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      title="Copy SQL"
      onClick={() => {
        navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  )
}

/** Collapsible SQL block shown under an assistant answer. */
export function SqlDisclosure({ response }: { response: ChatResponse }) {
  const [tab, setTab] = useState<'executed' | 'generated'>('executed')
  const [open, setOpen] = useState(false)

  const generated = response.generated_sql ?? ''
  const executed = response.executed_sql ?? ''
  if (!generated && !executed) return null

  const rewritten = Boolean(generated && executed && generated.trim() !== executed.trim())
  const current = tab === 'executed' ? executed || generated : generated

  return (
    <div className="mt-2 overflow-hidden border border-border bg-surface">
      <div className="flex h-8 items-center gap-1 border-b border-border px-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="px-1.5 text-2xs font-medium text-muted cursor-pointer hover:text-fg"
        >
          {open ? 'Hide SQL' : 'View SQL'}
        </button>

        {open && (
          <>
            <div className="mx-1 h-4 w-px bg-border" aria-hidden />
            {(['executed', 'generated'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={cn(
                  'border-b-2 px-1.5 py-0.5 text-2xs uppercase tracking-[0.08em] cursor-pointer transition-colors',
                  tab === key
                    ? 'border-accent text-fg'
                    : 'border-transparent text-subtle hover:text-fg',
                )}
              >
                {key === 'executed' ? 'Executed' : 'Generated'}
              </button>
            ))}
            {rewritten && (
              <Badge tone="info" className="ml-1">
                rewritten by guard
              </Badge>
            )}
          </>
        )}

        <div className="flex-1" />
        {open && <CopyButton text={current} />}
      </div>

      {open && (
        <>
          <SqlViewer sql={current} height={Math.min(220, 40 + current.split('\n').length * 19)} />
          {response.warnings.length > 0 && (
            <ul className="border-t border-border px-2.5 py-1.5">
              {response.warnings.map((w, i) => (
                <li key={i} className="text-2xs text-warn">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** Trust indicators shown inline with the answer (spec section 64). */
export function TrustBar({ response }: { response: ChatResponse }) {
  const result = response.result
  if (!result && !response.executed_sql) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-subtle">
      {response.executed_sql && (
        <span className="flex items-center gap-1 text-ok">
          <Check className="h-3 w-3" aria-hidden /> SQL validated
        </span>
      )}
      <span className="flex items-center gap-1 text-ok">
        <Check className="h-3 w-3" aria-hidden /> read-only
      </span>
      {result && <span>{formatDuration(result.duration_ms)}</span>}
      {result && <span>{formatNumber(result.row_count)} rows</span>}
    </div>
  )
}

export function QueryDetailsDrawer({
  response,
  onClose,
}: {
  response: ChatResponse
  onClose: () => void
}) {
  const result = response.result
  const cost = response.cost

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col overflow-hidden
                 border-l border-border-strong bg-surface shadow-popover
                 lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shrink-0 lg:shadow-none"
      aria-label="Query details"
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-xs font-medium">Query details</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close details">
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Detail label="Status" value={response.errors.length ? 'Failed' : 'Success'} />
          <Detail label="Duration" value={formatDuration(result?.duration_ms)} />
          <Detail label="Rows" value={formatNumber(result?.row_count)} />
          <Detail label="Truncated" value={result?.truncated ? 'Yes' : 'No'} />
        </dl>

        {cost && (
          <section>
            <h3 className="mb-1.5 text-2xs uppercase tracking-wide text-subtle">Query plan</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <Detail label="Estimated cost" value={cost.total_cost.toFixed(2)} />
              <Detail label="Estimated rows" value={formatNumber(cost.estimated_rows)} />
              <Detail label="Sequential scan" value={cost.has_sequential_scan ? 'Yes' : 'No'} />
              <Detail label="Relations" value={cost.scanned_relations.join(', ') || '—'} />
            </dl>
            {cost.warnings.map((w, i) => (
              <p key={i} className="mt-1.5 text-2xs text-warn">
                {w}
              </p>
            ))}
          </section>
        )}

        {response.tables_used.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-2xs uppercase tracking-wide text-subtle">
              Schema context sent
            </h3>
            <ul className="flex flex-wrap gap-1">
              {response.tables_used.map((t) => (
                <li key={t}>
                  <Badge tone="neutral" className="font-mono">
                    {t}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {response.errors.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-2xs uppercase tracking-wide text-subtle">Errors</h3>
            {response.errors.map((e, i) => (
              <div key={i} className="mb-1.5 border border-danger/30 bg-danger/5 p-2">
                <p className="font-mono text-2xs text-danger">
                  {e.stage} · {e.code}
                </p>
                <p className="mt-0.5 text-2xs text-fg">{e.message}</p>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-subtle">{label}</dt>
      <dd className="truncate font-mono text-xs text-fg">{value}</dd>
    </div>
  )
}
