import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Github, Info } from 'lucide-react'

import { Collapse, Reveal, SwapText } from '@/components/motion'
import { Button, ErrorState, Input } from '@/components/ui'
import { ApiRequestError, api, tokens } from '@/lib/api'
import {
  OAUTH_CANCELLED_NOTICE,
  clearOAuthOrigin,
  peekOAuthOrigin,
  rememberOAuthOrigin,
} from '@/lib/oauth'

/**
 * Sign in and sign up are one form with two modes, but each mode is a real
 * route (/login, /register) so both are linkable, bookmarkable, and can be
 * targeted directly from the landing page.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const mode: 'login' | 'register' = pathname === '/register' ? 'register' : 'login'
  // The backend sends a cancelled OAuth attempt here rather than to the error
  // page. Only a known flag is honoured, so nothing from the URL is rendered.
  const cancelled = searchParams.get('notice') === OAUTH_CANCELLED_NOTICE
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organization, setOrganization] = useState('My Organization')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A full-page redirect is not instant, and the button stays clickable until
  // it happens. Latch which provider is going so a second click cannot start
  // a second authorization round trip.
  const [redirecting, setRedirecting] = useState<'google' | 'github' | null>(null)

  // The backend sends every cancellation to /login. If it began on the
  // sign-up form, put the user back there -- same notice, same history entry.
  // Only that one direction: this page stays mounted across the move, so the
  // effect runs again on /register with the origin already consumed, and must
  // not read the /login default as a reason to send the user back.
  useEffect(() => {
    if (!cancelled) return
    const origin = peekOAuthOrigin()
    clearOAuthOrigin()
    if (origin === '/register' && pathname === '/login') {
      navigate(`/register?notice=${OAUTH_CANCELLED_NOTICE}`, { replace: true })
    }
  }, [cancelled, pathname, navigate])

  // Pressing Back on the provider's page can restore this page from the
  // back/forward cache exactly as it was left: latched on "Redirecting...",
  // with both buttons disabled. That is a cancellation too, so release it.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(null)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const pair =
        mode === 'login'
          ? await api.auth.login({ email, password })
          : await api.auth.register({
              email,
              password,
              organization_name: organization,
            })
      tokens.set(pair)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const socialSignIn = (provider: 'google' | 'github') => {
    if (redirecting) return
    setRedirecting(provider)
    rememberOAuthOrigin(pathname)
    window.location.assign(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/auth/oauth/${provider}/start`)
  }

  const submitState = busy ? `${mode}-busy` : mode

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Reveal index={0} variant="fade">
          <Link
            to="/"
            className="group mb-4 inline-flex items-center gap-1.5 text-2xs uppercase tracking-[0.1em]
                       text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft
              className="h-3 w-3 transition-transform duration-base motion-safe:group-hover:-translate-x-0.5"
              aria-hidden
            />{' '}
            Back to home
          </Link>
        </Reveal>

        <Reveal index={1} className="mb-5 flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 shrink-0 place-items-center border border-accent bg-accent
                       font-mono text-xs font-semibold text-accent-fg"
            aria-hidden
          >
            DB
          </div>
          <div>
            <h1 className="text-sm font-medium text-fg">EasyQuery</h1>
            <p className="text-2xs text-subtle">Natural-language analytics over your databases</p>
          </div>
        </Reveal>

        <Reveal as="form" index={2} onSubmit={submit} className="panel">
          <header className="flex h-8 items-center overflow-hidden border-b border-border bg-elevated px-3">
            <h2 className="micro">
              <SwapText state={mode}>{mode === 'login' ? 'Sign in' : 'Create account'}</SwapText>
            </h2>
          </header>

          <div className="space-y-3 p-4">
            {cancelled && (
              <Reveal
                as="p"
                role="status"
                className="flex items-start gap-2 border border-border bg-elevated p-3 text-xs text-muted"
              >
                <Info className="mt-px h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                Sign-in was cancelled. Please try again.
              </Reveal>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={redirecting === 'google'}
              disabled={redirecting !== null || busy}
              onClick={() => socialSignIn('google')}
            >
              {redirecting === 'google' ? 'Redirecting...' : 'Continue with Google'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={redirecting === 'github'}
              disabled={redirecting !== null || busy}
              onClick={() => socialSignIn('github')}
            >
              {redirecting !== 'github' && <Github className="h-3.5 w-3.5" aria-hidden />}
              {redirecting === 'github' ? 'Redirecting...' : 'Continue with GitHub'}
            </Button>
            <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.1em] text-subtle">
              <span className="h-px flex-1 bg-border" /> Or <span className="h-px flex-1 bg-border" />
            </div>
            <Input
              name="email"
              type="email"
              label="Email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              name="password"
              type="password"
              label="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 12 : undefined}
              hint={mode === 'register' ? 'At least 12 characters.' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* The extra field opens in place rather than popping in, so the
                submit button slides down instead of jumping. The space-y
                margin would sit outside the collapsing box, so it is inside. */}
            <Collapse open={mode === 'register'} className="!mt-0">
              <div className="pt-3">
                <Input
                  name="organization"
                  label="Organization"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                />
              </div>
            </Collapse>

            {error && <ErrorState message={error} />}

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={redirecting !== null}
              className="w-full"
            >
              <SwapText state={submitState}>
                {busy
                  ? mode === 'login'
                    ? 'Signing in...'
                    : 'Creating account...'
                  : mode === 'login'
                    ? 'Sign in'
                    : 'Create account'}
              </SwapText>
            </Button>

            <div className="border-t border-border pt-3 text-center">
              <Link
                to={mode === 'login' ? '/register' : '/login'}
                className="link-underline cursor-pointer text-xs text-muted hover:text-fg"
              >
                {mode === 'login' ? 'No account? Create one' : 'Already have an account? Sign in'}
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
