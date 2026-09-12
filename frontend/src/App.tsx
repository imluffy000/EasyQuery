import { lazy, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, WifiOff } from 'lucide-react'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppShell } from '@/components/layout/AppShell'
import { Button, ErrorPage, Spinner } from '@/components/ui'
import { ApiRequestError, api, tokens } from '@/lib/api'
import { LandingPage } from '@/pages/Landing'
import { LoginPage } from '@/pages/Login'
import { NotFoundPage } from '@/pages/NotFound'

/*
 * Routes are split so the Suspense boundary in AppShell is real. Imported
 * eagerly, every page landed in the entry bundle and that fallback could
 * never fire. Login stays eager: it is the first paint for a signed-out user.
 */
const DashboardPage = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.DashboardPage })))
const DatabasesPage = lazy(() => import('@/pages/Databases').then((m) => ({ default: m.DatabasesPage })))
const ChatPage = lazy(() => import('@/pages/Chat').then((m) => ({ default: m.ChatPage })))
const SchemaPage = lazy(() => import('@/pages/Schema').then((m) => ({ default: m.SchemaPage })))
const HistoryPage = lazy(() => import('@/pages/History').then((m) => ({ default: m.HistoryPage })))
const SavedPage = lazy(() => import('@/pages/Saved').then((m) => ({ default: m.SavedPage })))
const AnalyticsPage = lazy(() => import('@/pages/Analytics').then((m) => ({ default: m.AnalyticsPage })))
const SettingsPage = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.SettingsPage })))
const AdminPage = lazy(() => import('@/pages/Admin').then((m) => ({ default: m.AdminPage })))
import { useAppStore } from '@/stores/useAppStore'

/**
 * Gate. Membership is fetched once and the active workspace resolved from it,
 * so no page has to guess which workspace it is operating in.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const workspaceId = useAppStore((s) => s.workspaceId)
  const setWorkspace = useAppStore((s) => s.setWorkspace)
  const hasToken = Boolean(tokens.access)

  const { data: memberships, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['memberships'],
    queryFn: api.auth.memberships,
    enabled: hasToken,
    retry: false,
  })

  useEffect(() => {
    if (!memberships?.length) return
    // Keep the stored workspace only if the user is still a member of it.
    const valid = memberships.some((m) => m.workspace.id === workspaceId)
    if (!valid) setWorkspace(memberships[0]!.workspace.id)
  }, [memberships, workspaceId, setWorkspace])

  if (!hasToken) return <Navigate to="/login" replace state={{ from: location }} />

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (isError) {
    // A 401 here means the client already tried its refresh flow and it
    // failed, so the session genuinely is gone. Anything else -- offline, a
    // 5xx, a proxy hiccup -- is not evidence of that, and clearing the tokens
    // on it would turn a momentary blip into a forced logout.
    if (error instanceof ApiRequestError && error.status === 401) {
      tokens.clear()
      return <Navigate to="/login" replace />
    }
    return (
      <ErrorPage
        icon={<WifiOff className="h-7 w-7" aria-hidden />}
        code="Connection problem"
        title="Could not load your workspace"
        description="EasyQuery could not reach the server. You are still signed in -- check your connection and try again."
        actions={
          <>
            <Button variant="primary" onClick={() => void refetch()}>
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                tokens.clear()
                window.location.assign('/login')
              }}
            >
              Sign out
            </Button>
          </>
        }
      />
    )
  }

  return <>{children}</>
}

/** The marketing page is for signed-out visitors; members go to the app. */
function PublicOnly({ children }: { children: React.ReactNode }) {
  if (tokens.access) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

/**
 * Only codes the backend actually emits are given text; an unrecognised value
 * falls back to the generic sentence rather than being echoed from the URL.
 * A deliberate cancellation never reaches here -- the backend sends that
 * straight to /login.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  not_configured: 'Social sign-in is not configured for this deployment.',
  invalid_state: 'This sign-in request expired or could not be verified. Please try again.',
  missing_code: 'The provider did not return an authorization code. Please try again.',
  provider_error: 'The provider could not complete sign-in. Please try again.',
  account_disabled: 'This account has been disabled.',
  server_error: 'The provider reported an error. Please try again shortly.',
  temporarily_unavailable: 'The provider is temporarily unavailable. Please try again shortly.',
  invalid_request: 'The sign-in request was rejected by the provider.',
  unauthorized_client: 'This application is not authorized for sign-in with that provider.',
  invalid_scope: 'The sign-in request asked for permissions the provider refused.',
  unsupported_response_type: 'The provider rejected the sign-in request format.',
  interaction_required: 'The provider needs you to sign in again. Please try again.',
  login_required: 'The provider needs you to sign in again. Please try again.',
  consent_required: 'The provider needs your consent to continue. Please try again.',
  account_selection_required: 'Please choose an account and try again.',
}

function OAuthCallback() {
  const [error, setError] = useState<string | null>(null)
  const location = useLocation()
  useEffect(() => {
    const values = new URLSearchParams(location.hash.slice(1))
    const access = values.get('access_token')
    const refresh = values.get('refresh_token')
    if (access && refresh) {
      tokens.set({ access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 0 })
      window.history.replaceState(null, '', '/dashboard')
      window.location.replace('/dashboard')
    } else {
      const code = new URLSearchParams(location.search).get('error')
      setError(
        (code && OAUTH_ERROR_MESSAGES[code]) ?? 'Social sign-in could not be completed.',
      )
    }
  }, [location, setError])

  if (error) {
    return (
      <ErrorPage
        icon={<AlertTriangle className="h-7 w-7" aria-hidden />}
        code="Sign-in failed"
        title="Could not complete sign-in"
        description={error}
        actions={
          <Link
            to="/login"
            className="inline-flex h-8 cursor-pointer items-center border border-accent bg-accent px-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
          >
            Back to sign in
          </Link>
        }
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted">Signing you in…</div>
  )
}

export function App() {
  return (
    // Outermost net: catches anything the routed boundary does not, including
    // a throw from the shell itself.
    <ErrorBoundary>
        <Routes>
        <Route
          path="/"
          element={
            <PublicOnly>
              <LandingPage />
            </PublicOnly>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LoginPage />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/databases" element={<DatabasesPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/schema" element={<SchemaPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
    </ErrorBoundary>
  )
}
