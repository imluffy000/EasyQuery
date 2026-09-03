import { Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bookmark,
  Database,
  History,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Table2,
} from 'lucide-react'

import { DatabaseSelector } from '@/components/layout/DatabaseSelector'
import { Button, Spinner } from '@/components/ui'
import { tokens } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/databases', label: 'Databases', icon: Database },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/schema', label: 'Schema', icon: Table2 },
  { to: '/history', label: 'History', icon: History },
  { to: '/saved', label: 'Saved', icon: Bookmark },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
] as const

export function AppShell() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)

  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Main"
          className={cn(
            'flex shrink-0 flex-col justify-between border-r border-border bg-surface',
            'transition-[width] duration-200',
            collapsed ? 'w-13' : 'w-52',
          )}
        >
          <ul className="flex flex-col gap-0.5 p-2">
            {NAV.map(({ to, label, icon: Icon, ...rest }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={'end' in rest ? rest.end : undefined}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-8 items-center gap-2.5 rounded px-2.5 text-sm cursor-pointer',
                      'transition-colors',
                      isActive
                        ? 'bg-elevated text-fg font-medium'
                        : 'text-muted hover:bg-elevated/60 hover:text-fg',
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-0.5 border-t border-border p-2">
            <NavLink
              to="/settings"
              title={collapsed ? 'Settings' : undefined}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded px-2.5 text-sm cursor-pointer transition-colors',
                  isActive
                    ? 'bg-elevated text-fg font-medium'
                    : 'text-muted hover:bg-elevated/60 hover:text-fg',
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden />
              {!collapsed && <span>Settings</span>}
            </NavLink>
            <button
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="flex h-8 items-center gap-2.5 rounded px-2.5 text-sm text-muted
                         cursor-pointer transition-colors hover:bg-elevated/60 hover:text-fg"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
              )}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

function TopBar() {
  const navigate = useNavigate()
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  const cycleTheme = () =>
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')

  const signOut = () => {
    tokens.clear()
    navigate('/login', { replace: true })
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2 pr-1">
        <div
          className="grid h-6 w-6 place-items-center rounded bg-accent text-accent-fg
                     font-mono text-2xs font-semibold"
          aria-hidden
        >
          DB
        </div>
        <span className="text-sm font-medium tracking-tight">Copilot</span>
      </div>

      <div className="h-5 w-px bg-border" aria-hidden />

      <DatabaseSelector />

      <div className="flex-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={cycleTheme}
        title={`Theme: ${theme}`}
        aria-label={`Theme: ${theme}. Click to change.`}
      >
        <ThemeIcon className="h-4 w-4" aria-hidden />
      </Button>
      <Button size="sm" variant="ghost" onClick={signOut} title="Sign out" aria-label="Sign out">
        <LogOut className="h-4 w-4" aria-hidden />
      </Button>
    </header>
  )
}
