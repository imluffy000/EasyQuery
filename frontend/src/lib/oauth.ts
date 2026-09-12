/**
 * Where a social sign-in started, so a cancelled one can go back there.
 *
 * The backend returns every cancellation to /login, because it cannot know
 * whether the user pressed "Continue with Google" on the sign-in form or the
 * sign-up form. The browser does know: it records the origin just before the
 * full-page redirect, and reads it back when the user returns.
 *
 * Only the two known auth routes are ever stored or returned. The value
 * decides where the app navigates, so anything else is discarded rather than
 * followed -- this must not become an open redirect.
 */

const KEY = 'eq.oauth.origin'

export type AuthRoute = '/login' | '/register'

function isAuthRoute(value: unknown): value is AuthRoute {
  return value === '/login' || value === '/register'
}

export function rememberOAuthOrigin(route: string): void {
  if (!isAuthRoute(route)) return
  try {
    sessionStorage.setItem(KEY, route)
  } catch {
    // Storage can be unavailable (private mode, blocked). Falling back to
    // /login is the backend's behaviour anyway.
  }
}

/** Read the recorded origin without clearing it. Defaults to /login. */
export function peekOAuthOrigin(): AuthRoute {
  try {
    const value = sessionStorage.getItem(KEY)
    return isAuthRoute(value) ? value : '/login'
  } catch {
    return '/login'
  }
}

export function clearOAuthOrigin(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* see rememberOAuthOrigin */
  }
}

/** The notice flag the backend appends when a user cancels at the provider. */
export const OAUTH_CANCELLED_NOTICE = 'oauth_cancelled'

/** What Google and GitHub send when the user presses Cancel or Deny. */
export const OAUTH_CANCELLED_ERROR = 'access_denied'
