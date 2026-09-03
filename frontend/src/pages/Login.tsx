import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, ErrorState, Input } from '@/components/ui'
import { ApiRequestError, api, tokens } from '@/lib/api'

export function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
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
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div
            className="grid h-7 w-7 place-items-center rounded bg-accent text-accent-fg
                       font-mono text-xs font-semibold"
            aria-hidden
          >
            DB
          </div>
          <div>
            <h1 className="text-sm font-medium">Database Copilot</h1>
            <p className="text-2xs text-subtle">Natural-language analytics over your databases</p>
          </div>
        </div>

        <form onSubmit={submit} className="panel space-y-3 p-4">
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

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="w-full text-center text-xs text-muted cursor-pointer hover:text-fg"
          >
            {mode === 'login'
              ? 'No account? Create one'
              : 'Already have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
