import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Github } from 'lucide-react'

import { Button, ErrorState, Input } from '@/components/ui'
import { ApiRequestError, api, tokens } from '@/lib/api'

/**
 * Sign in and sign up are one form with two modes, but each mode is a real
 * route (/login, /register) so both are linkable, bookmarkable, and can be
 * targeted directly from the landing page.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const mode: 'login' | 'register' = pathname === '/register' ? 'register' : 'login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organization, setOrganization] = useState('My Organization')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    window.location.assign(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/auth/oauth/${provider}/start`)
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-2xs uppercase tracking-[0.1em]
                     text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Back to home
        </Link>

        <div className="mb-5 flex items-center gap-2.5">
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

        </div>

        <form onSubmit={submit} className="panel">
          <header className="flex h-8 items-center border-b border-border bg-elevated px-3">
            <h2 className="micro">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
          </header>

          <div className="space-y-3 p-4">
            <Button type="button" variant="secondary" className="w-full" onClick={() => socialSignIn('google')}>
              Continue with Google
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={() => socialSignIn('github')}>
              <Github className="h-3.5 w-3.5" aria-hidden /> Continue with GitHub
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
            {mode === 'register' && (
              <Input
                name="organization"
                label="Organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
              />
            )}

            {error && <ErrorState message={error} />}

            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>

            <div className="border-t border-border pt-3">
              <Link
                to={mode === 'login' ? '/register' : '/login'}
                className="block w-full cursor-pointer text-center text-xs text-muted hover:text-fg"
              >
                {mode === 'login' ? 'No account? Create one' : 'Already have an account? Sign in'}
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
