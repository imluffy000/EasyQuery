/**
 * Motion tokens and the hooks that decide whether motion should happen at all.
 *
 * Every duration, curve, spring and stagger used by an animated component
 * comes from here, so the app moves with one rhythm rather than a dozen
 * hand-picked numbers. The CSS side (tailwind.config.js) mirrors DURATION and
 * EASE_OUT under the same names; change them together.
 *
 * Motion in this app communicates something -- an arrival, a state change, a
 * press -- and is never decoration. Two rules follow from that:
 *   - Distances are small (a few pixels) and durations short. A workspace
 *     that makes people wait for its animations is slower, not nicer.
 *   - Reduced motion removes movement entirely. Content is rendered in its
 *     final state instead of being faded or slid into it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useReducedMotion, type Transition, type Variants } from 'motion/react'

/** Seconds, as Motion expects. */
export const DURATION = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.36,
} as const

/** Decelerating curve: quick to respond, soft to settle. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const

export const SPRING = {
  /** Press and release: firm, no visible overshoot. */
  press: { type: 'spring', stiffness: 700, damping: 35, mass: 0.5 },
  /** Small elements settling into place, e.g. a check mark. */
  pop: { type: 'spring', stiffness: 520, damping: 26, mass: 0.6 },
  /** Cursor-following, loose enough to feel attached rather than glued. */
  magnetic: { type: 'spring', stiffness: 220, damping: 18, mass: 0.5 },
} as const satisfies Record<string, Transition>

export const STAGGER = {
  tight: 0.03,
  base: 0.05,
  loose: 0.08,
} as const

/**
 * Beyond this many items a list stops staggering. Item 40 arriving two
 * seconds after item 1 reads as lag, and animating hundreds of rows costs
 * frames on the devices that can least afford them.
 */
export const STAGGER_LIMIT = 10

/** Pixels. Movement is a cue, not a journey. */
export const DISTANCE = {
  nudge: 3,
  lift: 8,
} as const

export const SCALE = {
  press: 0.97,
} as const

export const TWEEN: Transition = { duration: DURATION.base, ease: EASE_OUT }

const delayFor = (index: number, step: number = STAGGER.base) =>
  Math.min(Math.max(index, 0), STAGGER_LIMIT) * step

/**
 * Variants take the item's position as `custom`, so a list staggers without a
 * parent orchestrating it and items past STAGGER_LIMIT arrive without delay.
 */
export const VARIANTS = {
  fadeLift: {
    hidden: { opacity: 0, y: DISTANCE.lift },
    visible: (index: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: { ...TWEEN, delay: delayFor(index) },
    }),
  },
  /** A panel arriving from the right-hand edge it docks to. */
  fromEdge: {
    hidden: { opacity: 0, x: DISTANCE.lift * 2 },
    visible: (index: number = 0) => ({
      opacity: 1,
      x: 0,
      transition: { ...TWEEN, delay: delayFor(index) },
    }),
  },
  fade: {
    hidden: { opacity: 0 },
    visible: (index: number = 0) => ({
      opacity: 1,
      transition: { duration: DURATION.base, ease: EASE_OUT, delay: delayFor(index) },
    }),
  },
  /**
   * Mask reveal, top to bottom. clip-path is paint-only: no layout work.
   * It is removed once the reveal ends -- a leftover `inset(0%)` still clips,
   * and would cut off any popover, tooltip or fixed overlay inside.
   */
  clip: {
    hidden: { opacity: 0, clipPath: 'inset(0% 0% 100% 0%)' },
    visible: (index: number = 0) => ({
      opacity: 1,
      clipPath: 'inset(0% 0% 0% 0%)',
      transition: { duration: DURATION.slow, ease: EASE_OUT, delay: delayFor(index) },
      transitionEnd: { clipPath: 'none' },
    }),
  },
  /** Left-to-right wipe, for things that read in that direction (code). */
  wipe: {
    hidden: { opacity: 0, clipPath: 'inset(0% 100% 0% 0%)' },
    visible: (index: number = 0) => ({
      opacity: 1,
      clipPath: 'inset(0% 0% 0% 0%)',
      transition: { duration: DURATION.slow, ease: EASE_OUT, delay: delayFor(index) },
      transitionEnd: { clipPath: 'none' },
    }),
  },
} as const satisfies Record<string, Variants>

export type RevealVariant = keyof typeof VARIANTS

// --- Capability hooks -------------------------------------------------------

function subscribeMedia(query: string) {
  return (notify: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const media = window.matchMedia(query)
    media.addEventListener('change', notify)
    return () => media.removeEventListener('change', notify)
  }
}

export function useMediaQuery(query: string): boolean {
  // Subscribe is memoised per query so the store is not re-subscribed on
  // every render.
  const subscribe = useRef<{ query: string; fn: (n: () => void) => () => void } | null>(null)
  if (!subscribe.current || subscribe.current.query !== query) {
    subscribe.current = { query, fn: subscribeMedia(query) }
  }
  return useSyncExternalStore(
    subscribe.current.fn,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/**
 * A real hovering pointer. Touch screens report hover as a side effect of a
 * tap, which leaves "hover" styles stuck on; nothing hover-only may depend on
 * a device that cannot actually hover.
 */
export const HOVER_QUERY = '(hover: hover) and (pointer: fine)'

export function useCanHover(): boolean {
  return useMediaQuery(HOVER_QUERY)
}

/** True when motion should be skipped. Null (unknown) is treated as allowed. */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false
}

/**
 * A value that is set by an action and clears itself, for confirmations such
 * as "Copied" or "Connected". It only ever reflects something that actually
 * happened: callers flash it from a resolved promise, never optimistically.
 */
export function useFlash<T extends string>(ms = 1600): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flash = useCallback(
    (next: T) => {
      window.clearTimeout(timer.current)
      setValue(next)
      timer.current = window.setTimeout(() => setValue(null), ms)
    },
    [ms],
  )

  return [value, flash]
}
