/**
 * Scroll-linked motion, on GSAP + ScrollTrigger.
 *
 * Only the public landing page uses these, and only where scroll position is
 * itself the story (a hero that recedes, a sequence that fills in as it is
 * read). GSAP is imported on demand, so the workspace never downloads it.
 *
 * Nothing here takes over scrolling: triggers observe native scroll and
 * scrub transforms. Everything is registered inside gsap.matchMedia, which
 * does two jobs at once -- it applies effects only on wide, motion-tolerant
 * screens, and reverting it kills every tween and trigger it created.
 */

import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type Gsap = typeof import('gsap').gsap

/** Desktop and tablet-landscape, with motion allowed. Phones get none of this. */
const SCROLL_MEDIA = '(min-width: 768px) and (prefers-reduced-motion: no-preference)'

function useScrollEffect(
  setup: (gsap: Gsap, element: HTMLElement) => void,
  media: string = SCROLL_MEDIA,
) {
  const ref = useRef<HTMLDivElement>(null)
  // Read through a ref so an inline setup function does not re-run the effect.
  const setupRef = useRef(setup)
  setupRef.current = setup

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let cancelled = false
    let revert: (() => void) | undefined

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        if (cancelled) return
        gsap.registerPlugin(ScrollTrigger)
        const mm = gsap.matchMedia()
        mm.add(media, () => setupRef.current(gsap, element))
        revert = () => mm.revert()
      })
      // Decorative only: if the chunk fails to load the page is complete
      // without it.
      .catch(() => {})

    return () => {
      cancelled = true
      revert?.()
    }
  }, [media])

  return ref
}

/**
 * Drifts its content against the scroll by a small fraction of its height.
 * Apply to a wrapper, never to an element Motion is also animating: two
 * libraries writing one element's transform will fight.
 */
export function ParallaxElement({
  children,
  className,
  /** Percent of the element's own height travelled across the trigger range. */
  depth = 6,
}: {
  children: ReactNode
  className?: string
  depth?: number
}) {
  const ref = useScrollEffect((gsap, element) => {
    gsap.fromTo(
      element,
      { yPercent: 0 },
      {
        yPercent: -depth,
        ease: 'none',
        scrollTrigger: { trigger: element, start: 'top 60%', end: 'bottom top', scrub: 0.4 },
      },
    )
  })

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

/**
 * A rule that fills as its section is read, tying a numbered sequence to the
 * reader's progress through it. Decorative and hidden from assistive tech;
 * the sequence itself is already an ordered list.
 */
export function ScrollProgress({ className }: { className?: string }) {
  const ref = useScrollEffect((gsap, element) => {
    const bar = element.firstElementChild
    if (!bar) return
    gsap.fromTo(
      bar,
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: element.parentElement ?? element,
          start: 'top 75%',
          end: 'bottom 55%',
          scrub: 0.4,
        },
      },
    )
  })

  return (
    <div ref={ref} aria-hidden className={cn('pointer-events-none overflow-hidden', className)}>
      {/* Starts filled so the rule is complete wherever GSAP does not run. */}
      <div className="h-full w-full origin-left bg-accent" />
    </div>
  )
}
