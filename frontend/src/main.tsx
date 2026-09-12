import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from '@/App'
import { UnsavedChangesProvider } from '@/lib/unsavedChanges'
import { applyTheme, useAppStore, watchSystemTheme } from '@/stores/useAppStore'
import '@/index.css'

// Applied before first paint so the app never flashes the wrong theme.
applyTheme(useAppStore.getState().theme)
watchSystemTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 401 is handled by the client's refresh flow; retrying here would
      // only multiply failed requests.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof Error && error.message.includes('401')),
    },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Inside the router: the guard navigates on the user's behalf. */}
        <UnsavedChangesProvider>
          <App />
        </UnsavedChangesProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
