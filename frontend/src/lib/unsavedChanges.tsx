/**
 * Leave protection for work that only exists in the browser.
 *
 * Two different ways of leaving have to be covered, and only one of them is
 * ours. Closing or reloading the tab belongs to the browser, and `beforeunload`
 * is the only hook into it -- the prompt there is the browser's own wording,
 * never ours. In-app navigation is ours, but React Router's `useBlocker` needs
 * a data router and this app mounts a plain `BrowserRouter`, so navigation is
 * routed through `useGuardedNavigate` instead of being intercepted.
 *
 * The confirmation lives here, once, rather than in each page: a page declares
 * only whether it currently holds unsaved work.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '@/components/ui'

export const UNSAVED_MESSAGE = 'You have unsaved changes. Are you sure you want to leave?'

interface UnsavedChangesApi {
  /** Declare (or withdraw) unsaved work under a stable key. */
  setDirty: (key: string, dirty: boolean) => void
  /** True while any surface holds unsaved work. */
  dirty: boolean
  /**
   * Run `proceed` if nothing would be lost, otherwise confirm first. Use for
   * any action that discards in-progress work, not just navigation.
   */
  requestLeave: (proceed: () => void) => void
}

const UnsavedChangesContext = createContext<UnsavedChangesApi | null>(null)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null)

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      if (dirty === prev.has(key)) return prev
      const next = new Set(prev)
      if (dirty) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const dirty = dirtyKeys.size > 0

  // The browser's own leave prompt. preventDefault is what arms it; the
  // returnValue assignment is the legacy form some browsers still require.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = UNSAVED_MESSAGE
      return UNSAVED_MESSAGE
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Read through a ref so the callback identity stays stable: it is passed to
  // nav links, and a new function every keystroke would re-render all of them.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const requestLeave = useCallback((proceed: () => void) => {
    if (!dirtyRef.current) {
      proceed()
      return
    }
    setPending({ proceed })
  }, [])

  const api = useMemo<UnsavedChangesApi>(
    () => ({ setDirty, dirty, requestLeave }),
    [setDirty, dirty, requestLeave],
  )

  return (
    <UnsavedChangesContext.Provider value={api}>
      {children}
      {pending && (
        <ConfirmDialog
          title="Unsaved changes"
          description={UNSAVED_MESSAGE}
          confirmLabel="Leave"
          cancelLabel="Cancel"
          tone="danger"
          onConfirm={() => {
            const { proceed } = pending
            setPending(null)
            proceed()
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </UnsavedChangesContext.Provider>
  )
}

function useUnsavedChanges(): UnsavedChangesApi {
  const context = useContext(UnsavedChangesContext)
  if (!context) {
    throw new Error('useUnsavedChanges requires <UnsavedChangesProvider>')
  }
  return context
}

/**
 * Declare that this surface holds unsaved work. Registration is withdrawn on
 * unmount, so a page that navigates away cannot leave a stale guard armed and
 * block every later navigation.
 */
export function useUnsavedGuard(key: string, dirty: boolean): void {
  const { setDirty } = useUnsavedChanges()
  useEffect(() => {
    setDirty(key, dirty)
  }, [setDirty, key, dirty])
  useEffect(() => () => setDirty(key, false), [setDirty, key])
}

/** Navigate, confirming first if that would discard unsaved work. */
export function useGuardedNavigate(): (to: string) => void {
  const { requestLeave } = useUnsavedChanges()
  const navigate = useNavigate()
  return useCallback(
    (to: string) => requestLeave(() => navigate(to)),
    [requestLeave, navigate],
  )
}

/** Confirm before any action that would discard unsaved work. */
export function useRequestLeave(): (proceed: () => void) => void {
  return useUnsavedChanges().requestLeave
}
