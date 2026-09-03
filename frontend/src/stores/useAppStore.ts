/** Local UI state. Server state belongs to TanStack Query, not here. */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface AppState {
  theme: Theme
  sidebarCollapsed: boolean
  workspaceId: string | null
  databaseId: string | null
  /** Recently used database ids, most recent first. */
  recentDatabases: string[]
  favoriteDatabases: string[]

  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  setWorkspace: (id: string | null) => void
  setDatabase: (id: string | null) => void
  toggleFavorite: (id: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      workspaceId: null,
      databaseId: null,
      recentDatabases: [],
      favoriteDatabases: [],

      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setWorkspace: (workspaceId) => set({ workspaceId }),
      setDatabase: (databaseId) =>
        set((s) => ({
          databaseId,
          recentDatabases: databaseId
            ? [databaseId, ...s.recentDatabases.filter((id) => id !== databaseId)].slice(0, 5)
            : s.recentDatabases,
        })),
      toggleFavorite: (id) =>
        set((s) => ({
          favoriteDatabases: s.favoriteDatabases.includes(id)
            ? s.favoriteDatabases.filter((f) => f !== id)
            : [...s.favoriteDatabases, id],
        })),
    }),
    { name: 'dbc.ui' },
  ),
)

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark))
}

/** Keep 'system' in sync when the OS preference changes mid-session. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (useAppStore.getState().theme === 'system') applyTheme('system')
  }
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}
