/**
 * Motion primitives.
 *
 * Built on Motion's `m` components inside a LazyMotion boundary, which keeps
 * the animation runtime to the dom-animation feature set (no drag, no layout
 * projection). Nothing here uses `layout`: layout animations measure the page
 * every frame, and the few height changes that do animate are single,
 * user-initiated disclosures.
 *
 * Every primitive renders its content in the final state when the user asks
 * for reduced motion, so nothing is ever left invisible waiting on an
 * animation that will not run.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from 'react'
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  useSpring,
} from 'motion/react'

import {
  DISTANCE,
  DURATION,
  EASE_OUT,
  SPRING,
  STAGGER_LIMIT,
  VARIANTS,
  useCanHover,
  useMediaQuery,
  usePrefersReducedMotion,
  type RevealVariant,
} from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Mounted once at the root. `reducedMotion="user"` is the backstop for any
 *  transform a primitive below does not already skip. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

const TAGS = {
  div: m.div,
  section: m.section,
  article: m.article,
  aside: m.aside,
  header: m.header,
  h1: m.h1,
  h2: m.h2,
  h3: m.h3,
  ul: m.ul,
  ol: m.ol,
  li: m.li,
  p: m.p,
  span: m.span,
  figure: m.figure,
  form: m.form,
} as const

type Tag = keyof typeof TAGS

type RevealProps = {
  as?: Tag
  variant?: RevealVariant
  /** Position in a sequence; drives the stagger delay. */
  index?: number
  /**
   * `mount` animates as soon as the element renders, for content already on
   * screen. `inView` waits until it scrolls into the viewport.
   */
  when?: 'mount' | 'inView'
  className?: string
  children?: ReactNode
  id?: string
} & Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className' | 'id' | keyof MotionHandlers>

/** DOM handlers whose signatures Motion redefines; not accepted here. */
type MotionHandlers = Pick<
  ComponentPropsWithoutRef<'div'>,
  'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'
>

/**
 * Fade-and-lift (or fade, mask, wipe) into place. The workhorse: page
 * sections, cards, result blocks and states all arrive through this.
 */
export function Reveal({
  as = 'div',
  variant = 'fadeLift',
  index = 0,
  when = 'mount',
  className,
  children,
  ...rest
}: RevealProps) {
  const reduced = usePrefersReducedMotion()
  const Component = TAGS[as] as ElementType
  // Items past the stagger limit, and everything under reduced motion, render
  // in place. `initial={false}` means no hidden frame is ever painted.
  const skip = reduced || index > STAGGER_LIMIT * 2

  const trigger =
    when === 'inView'
      ? { whileInView: 'visible', viewport: { once: true, amount: 0.15, margin: '0px 0px -8% 0px' } }
      : { animate: 'visible' }

  return (
    <Component
      className={className}
      variants={VARIANTS[variant]}
      custom={index}
      initial={skip ? false : 'hidden'}
      {...(skip ? { animate: 'visible' } : trigger)}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * A group whose children stagger in when the group arrives. Children are
 * `StaggerItem`s; they inherit the trigger, so a list below the fold waits
 * for the list, not for each row.
 */
export function Stagger({
  as = 'div',
  when = 'mount',
  className,
  children,
  ...rest
}: {
  as?: Tag
  when?: 'mount' | 'inView'
  className?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className' | keyof MotionHandlers>) {
  const reduced = usePrefersReducedMotion()
  const Component = TAGS[as] as ElementType
  const trigger =
    when === 'inView'
      ? { whileInView: 'visible', viewport: { once: true, amount: 0.1 } }
      : { animate: 'visible' }

  return (
    <Component
      className={className}
      initial={reduced ? false : 'hidden'}
      {...(reduced ? { animate: 'visible' } : trigger)}
      {...rest}
    >
      {children}
    </Component>
  )
}

export function StaggerItem({
  as = 'div',
  index,
  variant = 'fadeLift',
  className,
  children,
  ...rest
}: {
  as?: Tag
  index: number
  variant?: RevealVariant
  className?: string
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className' | keyof MotionHandlers>) {
  const Component = TAGS[as] as ElementType
  // Far down a long list there is nothing to gain from animating; the row is
  // simply there. Opacity alone for the rest keeps the arrival continuous.
  const beyond = index >= STAGGER_LIMIT * 2
  return (
    <Component
      className={className}
      variants={beyond ? INSTANT : VARIANTS[variant]}
      custom={index}
      {...rest}
    >
      {children}
    </Component>
  )
}

const INSTANT = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { duration: 0 } },
}

/**
 * Route-level transition. Opacity only, and enter only: waiting on an exit
 * would delay navigation, and a transform here would become the containing
 * block for every `position: fixed` drawer and overlay on the page.
 */
export function PageTransition({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const reduced = usePrefersReducedMotion()
  return (
    <m.div
      key={routeKey}
      className="h-full"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      {children}
    </m.div>
  )
}

/**
 * Height disclosure. Used only for single, user-initiated expand/collapse --
 * never for content that arrives on its own, which would shift the page under
 * the reader.
 */
export function Collapse({
  open,
  children,
  className,
  id,
}: {
  open: boolean
  children: ReactNode
  className?: string
  id?: string
}) {
  // Open from the start means shown as-is; only a later change animates.
  // This is tracked here rather than with AnimatePresence's `initial={false}`,
  // which would also suppress the entrance of every motion element mounted
  // inside -- a clarification's options would stop staggering in.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <CollapsePanel key="collapse" id={id} className={className} animateIn={mounted.current}>
          {children}
        </CollapsePanel>
      )}
    </AnimatePresence>
  )
}

function CollapsePanel({
  animateIn,
  children,
  className,
  id,
}: {
  animateIn: boolean
  children: ReactNode
  className?: string
  id?: string
}) {
  const reduced = usePrefersReducedMotion()
  const transition = reduced ? { duration: 0 } : { duration: DURATION.base, ease: EASE_OUT }
  // Clipping is needed only while the height moves. Left on, it would cut off
  // the focus ring of every field and button at the box's edges.
  const [clipping, setClipping] = useState(animateIn)

  return (
    <m.div
      id={id}
      className={cn(clipping && 'overflow-hidden', className)}
      initial={animateIn ? { height: 0, opacity: 0 } : false}
      animate={{ height: 'auto', opacity: 1, transition }}
      exit={{ height: 0, opacity: 0, transition }}
      onAnimationStart={() => setClipping(true)}
      onAnimationComplete={(definition) => {
        // Fires for the exit too; stay clipped for that one.
        if ((definition as { height?: unknown }).height === 'auto') setClipping(false)
      }}
    >
      {children}
    </m.div>
  )
}

/**
 * Swap between labelled states -- Copy/Copied, Connect/Connecting/Connected --
 * with the outgoing label leaving as the new one arrives. `state` is the key;
 * the text itself is what assistive tech reads, so the label must say the
 * state in words, not only through the icon or the motion.
 */
export function SwapText({
  state,
  children,
  className,
}: {
  state: string
  children: ReactNode
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  return (
    <span className="relative inline-flex items-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={state}
          className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}
          initial={reduced ? false : { opacity: 0, y: DISTANCE.nudge * 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -DISTANCE.nudge * 2 }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}
        >
          {children}
        </m.span>
      </AnimatePresence>
    </span>
  )
}

/** A small icon that settles in with a spring, for confirmations. */
export const PopIn = forwardRef<HTMLSpanElement, { children: ReactNode; className?: string }>(
  function PopIn({ children, className }, ref) {
    const reduced = usePrefersReducedMotion()
    return (
      <m.span
        ref={ref}
        className={cn('inline-flex', className)}
        initial={reduced ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={SPRING.pop}
      >
        {children}
      </m.span>
    )
  },
)

const MAGNET_RADIUS = 6

/**
 * Pulls its child a few pixels toward the cursor. Desktop only: it needs a
 * fine hovering pointer and room to move, and it is off under reduced motion.
 * On every other device this renders a plain wrapper.
 */
export function MagneticButton({ children, className }: { children: ReactNode; className?: string }) {
  const canHover = useCanHover()
  const wide = useMediaQuery('(min-width: 1024px)')
  const reduced = usePrefersReducedMotion()
  const enabled = canHover && wide && !reduced

  const { stiffness, damping, mass } = SPRING.magnetic
  const x = useSpring(0, { stiffness, damping, mass })
  const y = useSpring(0, { stiffness, damping, mass })
  const ref = useRef<HTMLDivElement>(null)

  if (!enabled) return <div className={cn('inline-block', className)}>{children}</div>

  return (
    <m.div
      ref={ref}
      className={cn('inline-block', className)}
      style={{ x, y }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse') return
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2)
        const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2)
        x.set(Math.max(-1, Math.min(1, dx)) * MAGNET_RADIUS)
        y.set(Math.max(-1, Math.min(1, dy)) * (MAGNET_RADIUS / 2))
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </m.div>
  )
}

export { ParallaxElement, ScrollProgress } from './scroll'
