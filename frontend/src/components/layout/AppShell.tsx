import { Suspense } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/databases', label: 'Databases', icon: Database },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/schema', label: 'Schema', icon: Table2 },
  { to: '/history', label: 'History', icon: History },
  { to: '/saved', label: 'Saved', icon: Bookmark },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
] as const

const ITEM = 'flex h-8 items-center gap-2.5 px-2.5 cursor-pointer transition-colors border-l-2'

/**
 * Active state is a solid accent rule on the leading edge plus a ground
 * shift — two channels, so it does not depend on colour alone.
 */
const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    ITEM,
    'text-2xs font-medium uppercase tracking-[0.1em]',
    isActive
      ? 'border-accent bg-elevated text-fg'
      : 'border-transparent text-muted hover:bg-elevated hover:text-fg',
  )

export function AppShell() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const { pathname } = useLocation()

  const routeName =
    NAV.find((n) => pathname.startsWith(n.to))?.label ??
    (pathname.startsWith('/settings') ? 'Settings' : 'Page')

  return (
    <div className="flex h-full flex-col bg-bg">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50
                   focus:border focus:border-accent focus:bg-surface focus:px-3 focus:py-1.5
                   focus:text-xs"
      >
        Skip to content
      </a>

      <TopBar />

      <div className="flex min-h-0 flex-1">
        {/*
          Below lg the rail is always icon-only. The workspace needs its
          horizontal budget for the schema tree and the details drawer; a
          208px label column at 768px is what pushed content off-screen.
        */}
        <nav
          aria-label="Main"
          className={cn(
            'flex shrink-0 flex-col justify-between border-r border-border bg-surface',
            'transition-[width] duration-200',
            'w-13',
            collapsed ? 'lg:w-13' : 'lg:w-48',
          )}
        >
          <ul className="flex flex-col py-1.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  title={label}
                  className={itemClass}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className={cn('truncate', collapsed ? 'lg:hidden' : 'hidden lg:inline')}>
                    {label}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="flex flex-col border-t border-border py-1.5">
            <NavLink to="/settings" title="Settings" className={itemClass}>
              <Settings className="h-4 w-4 shrink-0" aria-hidden />
              <span className={cn('truncate', collapsed ? 'lg:hidden' : 'hidden lg:inline')}>
                Settings
              </span>
            </NavLink>
            <button
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              className={cn(
                ITEM,
                'hidden border-transparent text-2xs font-medium uppercase tracking-[0.1em]',
                'text-muted hover:bg-elevated hover:text-fg lg:flex',
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span className={cn(collapsed ? 'lg:hidden' : 'hidden lg:inline')}>Collapse</span>
            </button>
          </div>
        </nav>

        <main id="workspace" className="min-w-0 flex-1 overflow-hidden">
          {/* Route changes are otherwise silent for screen-reader users. */}
          <div aria-live="polite" className="sr-only">
            {routeName}
          </div>
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
    navigate('/', { replace: true })
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border-strong bg-surface px-3">
      <div className="flex items-center gap-2 pr-1">
        <div className="h-3 w-3 shrink-0 bg-accent" aria-hidden />
        <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-fg">Copilot</span>
      </div>

      <div className="h-5 w-px bg-border" aria-hidden />

      <DatabaseSelector />

      <div className="flex-1" />

      <Button
        size="sm"
        variant="ghost"
        onClick={cycleTheme}
        title={`Theme: ${theme}`}
        aria-label={`Theme: ${theme}. Activate to change.`}
      >
        <ThemeIcon className="h-4 w-4" aria-hidden />
      </Button>
      <Button size="sm" variant="ghost" onClick={signOut} title="Sign out" aria-label="Sign out">
        <LogOut className="h-4 w-4" aria-hidden />
      </Button>
    </header>
  )
}
