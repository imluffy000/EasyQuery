import { lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui'
import { api, tokens } from '@/lib/api'
import { LandingPage } from '@/pages/Landing'
import { LoginPage } from '@/pages/Login'

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

  const { data: memberships, isLoading, isError } = useQuery({
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
    tokens.clear()
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

/** The marketing page is for signed-out visitors; members go to the app. */
function PublicOnly({ children }: { children: React.ReactNode }) {
  if (tokens.access) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export function App() {
  return (
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
