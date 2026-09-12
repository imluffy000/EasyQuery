import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthCallback } from '@/App'
import { MotionProvider } from '@/components/motion'
import { rememberOAuthOrigin, peekOAuthOrigin } from '@/lib/oauth'
import { LoginPage } from '@/pages/Login'

function Where() {
  const { pathname, search } = useLocation()
  return <span data-testid="where">{pathname + search}</span>
}

function renderAt(url: string) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<LoginPage />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </MotionProvider>,
  )
}

const assign = vi.fn()

beforeEach(() => {
  // A real redirect would unload jsdom; record it instead.
  vi.stubGlobal('location', { ...window.location, assign, replace: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe('OAuth cancellation', () => {
  it('returns a cancelled sign-up to the sign-up form, with the notice', async () => {
    rememberOAuthOrigin('/register')
    renderAt('/login?notice=oauth_cancelled')

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/register?notice=oauth_cancelled'),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Sign-in was cancelled')
    expect(peekOAuthOrigin()).toBe('/login')
  })

  it('leaves a cancelled sign-in on the sign-in form', async () => {
    rememberOAuthOrigin('/login')
    renderAt('/login?notice=oauth_cancelled')

    expect(await screen.findByRole('status')).toHaveTextContent('Sign-in was cancelled')
    expect(screen.getByTestId('where')).toHaveTextContent('/login?notice=oauth_cancelled')
  })

  it('treats access_denied on the callback as a cancellation, not an error page', async () => {
    rememberOAuthOrigin('/register')
    renderAt('/oauth/callback?error=access_denied')

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/register?notice=oauth_cancelled'),
    )
    expect(screen.queryByText('Could not complete sign-in')).not.toBeInTheDocument()
  })

  it('still shows the error page for a genuine provider failure', async () => {
    renderAt('/oauth/callback?error=server_error')
    expect(await screen.findByText('Could not complete sign-in')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('records where the attempt started before redirecting to the provider', async () => {
    renderAt('/register')
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(assign).toHaveBeenCalledWith('/api/v1/auth/oauth/google/start')
    expect(peekOAuthOrigin()).toBe('/register')
  })

  it('releases the redirect latch when Back restores the page from the bfcache', async () => {
    renderAt('/login')
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    expect(screen.getByRole('button', { name: /Redirecting/ })).toBeDisabled()

    const restored = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(restored, 'persisted', { value: true })
    act(() => {
      window.dispatchEvent(restored)
    })

    expect(await screen.findByRole('button', { name: 'Continue with GitHub' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  })
})
