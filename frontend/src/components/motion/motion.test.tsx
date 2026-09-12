import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MotionProvider, Reveal, SwapText } from '@/components/motion'
import { useFlash } from '@/lib/motion'
import { setMedia } from '@/test/setup'

describe('Reveal', () => {
  it('starts hidden so it can animate in when motion is allowed', () => {
    render(
      <MotionProvider>
        <Reveal>Arriving</Reveal>
      </MotionProvider>,
    )
    expect(screen.getByText('Arriving')).toHaveStyle({ opacity: '0' })
  })

  it('renders in its final state under reduced motion, never hidden', () => {
    setMedia({ reducedMotion: true })
    render(
      <MotionProvider>
        <Reveal>Already here</Reveal>
      </MotionProvider>,
    )
    const element = screen.getByText('Already here')
    expect(element).not.toHaveStyle({ opacity: '0' })
    expect(element.style.transform).not.toMatch(/translate/)
  })

  it('keeps content in the accessibility tree while it animates', () => {
    render(
      <MotionProvider>
        <Reveal as="p" role="status">
          Query executed successfully.
        </Reveal>
      </MotionProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Query executed successfully.')
  })
})

describe('SwapText', () => {
  it('shows the label for the current state', () => {
    const { rerender } = render(
      <MotionProvider>
        <SwapText state="idle">Copy</SwapText>
      </MotionProvider>,
    )
    expect(screen.getByText('Copy')).toBeInTheDocument()

    rerender(
      <MotionProvider>
        <SwapText state="copied">Copied</SwapText>
      </MotionProvider>,
    )
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })
})

describe('useFlash', () => {
  it('holds a confirmation for its duration, then clears it', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useFlash<'done'>(1000))
    expect(result.current[0]).toBeNull()

    act(() => result.current[1]('done'))
    expect(result.current[0]).toBe('done')

    act(() => vi.advanceTimersByTime(999))
    expect(result.current[0]).toBe('done')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current[0]).toBeNull()
    vi.useRealTimers()
  })

  it('restarts the timer when flashed again', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useFlash<'a' | 'b'>(1000))
    act(() => result.current[1]('a'))
    act(() => vi.advanceTimersByTime(800))
    act(() => result.current[1]('b'))
    act(() => vi.advanceTimersByTime(800))
    expect(result.current[0]).toBe('b')
    vi.useRealTimers()
  })
})
