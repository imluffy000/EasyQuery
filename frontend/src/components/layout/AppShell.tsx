import { Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  UserCog,
} from 'lucide-react'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DatabaseSelector } from '@/components/layout/DatabaseSelector'
import { PageTransition, SwapText } from '@/components/motion'
import { Button, ConfirmDialog, LoadingState } from '@/components/ui'
import { api, tokens } from '@/lib/api'
import { useGuardedNavigate } from '@/lib/unsavedChanges'
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

const ITEM =
  'group flex h-8 items-center gap-2.5 px-2.5 cursor-pointer transition-colors duration-base border-l-2'

/** The icon leans toward its label on hover: a hint of where the click goes. */
const ICON = 'h-4 w-4 shrink-0 transition-transform duration-base motion-safe:group-hover:translate-x-0.5'

/**
 * A ctrl/cmd/shift click, or anything but the primary button, is a request to
 * open the link elsewhere. The current page is not being left, so the guard
 * must stand aside and let the browser handle it.
 */
function opensElsewhere(event: React.MouseEvent): boolean {
  return (
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
  )
}

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
  // NavLink handles its own navigation on click, which would skip the unsaved
  // work check. Keep NavLink for its styling and active state, but take the
  // navigation itself over.
  const guardedNavigate = useGuardedNavigate()
  const { pathname } = useLocation()
  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.auth.me, retry: false })
  const navigation = user?.is_superuser
    ? [...NAV, { to: '/admin', label: 'Administration', icon: UserCog }]
    : NAV

  const routeName =
    navigation.find((n) => pathname.startsWith(n.to))?.label ??
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
            {navigation.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  title={label}
                  className={itemClass}
                  onClick={(e) => {
                    if (opensElsewhere(e)) return
                    e.preventDefault()
                    // Re-clicking the current page discards nothing, so it must
                    // not ask.
                    if (to === pathname) return
                    guardedNavigate(to)
                  }}
                >
                  <Icon className={ICON} aria-hidden />
                  <span className={cn('truncate', collapsed ? 'lg:hidden' : 'hidden lg:inline')}>
                    {label}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="flex flex-col border-t border-border py-1.5">
            <NavLink
              to="/settings"
              title="Settings"
              className={itemClass}
              onClick={(e) => {
                if (opensElsewhere(e)) return
                e.preventDefault()
                if (pathname === '/settings') return
                guardedNavigate('/settings')
              }}
            >
              <Settings
                className={cn(ICON, 'motion-safe:group-hover:translate-x-0 motion-safe:group-hover:rotate-45')}
                aria-hidden
              />
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
          {/* Per-route, so a page that throws leaves the navigation usable
              and moving to another route clears it. The boundary is outside
              Suspense so it also catches a lazy chunk that fails to load. */}
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<LoadingState />}>
              <PageTransition routeKey={pathname}>
                <Outlet />
              </PageTransition>
            </Suspense>
          </ErrorBoundary>
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

  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  // Signing out is confirmed, then unconditional: the stored token pair is
  // cleared before navigating, so a cancelled dialog leaves the session
  // exactly as it was and a confirmed one cannot leave a usable token behind.
  const signOut = () => {
    tokens.clear()
    setConfirmingSignOut(false)
    navigate('/login', { replace: true })
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border-strong bg-surface px-3">
      <div className="flex items-center gap-2 pr-1">
        <div className="h-3 w-3 shrink-0 bg-accent" aria-hidden />
        <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-fg">EasyQuery</span>
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
        {/* The new icon slides in, so the change registers at a glance. */}
        <SwapText state={theme}>
          <ThemeIcon className="h-4 w-4" aria-hidden />
        </SwapText>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirmingSignOut(true)}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </Button>

      {confirmingSignOut && (
        <ConfirmDialog
          title="Log out"
          description="Are you sure you want to log out?"
          confirmLabel="Log out"
          cancelLabel="Cancel"
          onConfirm={signOut}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
    </header>
  )
}
