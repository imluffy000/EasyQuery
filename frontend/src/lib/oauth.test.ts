import { describe, expect, it } from 'vitest'

import { clearOAuthOrigin, peekOAuthOrigin, rememberOAuthOrigin } from '@/lib/oauth'

describe('OAuth origin', () => {
  it('defaults to the sign-in page when nothing was recorded', () => {
    expect(peekOAuthOrigin()).toBe('/login')
  })

  it('remembers the sign-up form as the origin', () => {
    rememberOAuthOrigin('/register')
    expect(peekOAuthOrigin()).toBe('/register')
  })

  it('never stores or returns a route outside the two auth forms', () => {
    rememberOAuthOrigin('https://evil.example/phish')
    expect(peekOAuthOrigin()).toBe('/login')

    // Even a value planted directly in storage is not followed.
    sessionStorage.setItem('eq.oauth.origin', '//evil.example')
    expect(peekOAuthOrigin()).toBe('/login')
  })

  it('clears the recorded origin', () => {
    rememberOAuthOrigin('/register')
    clearOAuthOrigin()
    expect(peekOAuthOrigin()).toBe('/login')
  })
})
