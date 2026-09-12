/**
 * jsdom lacks the media and observer APIs the motion layer reads. These stubs
 * are controllable, so a test can put the "device" into reduced-motion or
 * touch mode and have every listener hear the change, as a real browser would.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

type Listener = (event: MediaQueryListEvent) => void

const media = { reducedMotion: false, canHover: true, wide: true }
const lists = new Set<{ query: string; listeners: Set<Listener> }>()

function evaluate(query: string): boolean {
  if (query.includes('prefers-reduced-motion')) {
    const wantsReduce = query.includes('reduce') || !query.includes('no-preference')
    return query.includes('no-preference') ? !media.reducedMotion : wantsReduce && media.reducedMotion
  }
  if (query.includes('hover')) return media.canHover
  if (query.includes('min-width')) return media.wide
  return false
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => {
    const entry = { query, listeners: new Set<Listener>() }
    lists.add(entry)
    return {
      media: query,
      get matches() {
        return evaluate(query)
      },
      onchange: null,
      addEventListener: (_: string, fn: Listener) => entry.listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => entry.listeners.delete(fn),
      addListener: (fn: Listener) => entry.listeners.add(fn),
      removeListener: (fn: Listener) => entry.listeners.delete(fn),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList
  },
})

export function setMedia(next: Partial<typeof media>): void {
  Object.assign(media, next)
  for (const entry of lists) {
    const event = { matches: evaluate(entry.query), media: entry.query } as MediaQueryListEvent
    entry.listeners.forEach((fn) => fn(event))
  }
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

// Motion's whileInView and the virtualizer both construct these on mount.
window.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver
window.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  setMedia({ reducedMotion: false, canHover: true, wide: true })
  sessionStorage.clear()
})
