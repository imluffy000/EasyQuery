import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui'
import { api, tokens } from '@/lib/api'
import { AnalyticsPage } from '@/pages/Analytics'
import { ChatPage } from '@/pages/Chat'
import { DashboardPage } from '@/pages/Dashboard'
import { DatabasesPage } from '@/pages/Databases'
import { HistoryPage } from '@/pages/History'
import { LoginPage } from '@/pages/Login'
import { SavedPage } from '@/pages/Saved'
import { SchemaPage } from '@/pages/Schema'
import { SettingsPage } from '@/pages/Settings'
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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
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
