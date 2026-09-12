import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ClarificationPrompt, StatusTrail } from '@/components/chat/Prompts'
import { MotionProvider } from '@/components/motion'
import { setMedia } from '@/test/setup'
import type { Clarification } from '@/types/api'

const clarification: Clarification = {
  question: 'Which revenue do you mean?',
  dimension: 'revenue_definition',
  options: [
    { label: 'Gross revenue', value: 'gross' },
    { label: 'Net revenue', value: 'net' },
  ],
  allow_free_text: true,
}

function renderPrompt(onAnswer = vi.fn()) {
  // Reduced motion makes the fold instant, so assertions do not race it.
  setMedia({ reducedMotion: true })
  render(
    <MotionProvider>
      <ClarificationPrompt clarification={clarification} onAnswer={onAnswer} />
    </MotionProvider>,
  )
  return onAnswer
}

describe('ClarificationPrompt', () => {
  it('sends the chosen option once and records the answer in words', async () => {
    const onAnswer = renderPrompt()
    await userEvent.click(screen.getByRole('button', { name: 'Net revenue' }))

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith('net')
    expect(await screen.findByText('Answered:')).toBeInTheDocument()
    expect(screen.getByText('Net revenue')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Gross revenue' })).not.toBeInTheDocument(),
    )
  })

  it('moves keyboard focus to the answer instead of dropping it on the page', async () => {
    renderPrompt()
    const option = screen.getByRole('button', { name: 'Gross revenue' })
    option.focus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByText('Answered:').parentElement?.parentElement).toHaveFocus())
  })

  it('reopens the options when the answer is changed', async () => {
    const onAnswer = renderPrompt()
    await userEvent.click(screen.getByRole('button', { name: 'Gross revenue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Change answer' }))

    const again = await screen.findByRole('button', { name: 'Net revenue' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gross revenue' })).toHaveFocus())
    await userEvent.click(again)
    expect(onAnswer).toHaveBeenLastCalledWith('net')
  })

  it('submits a free-text clarification', async () => {
    const onAnswer = renderPrompt()
    await userEvent.type(screen.getByRole('textbox', { name: 'Custom clarification' }), 'booked revenue')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onAnswer).toHaveBeenCalledWith('booked revenue')
  })
})

describe('StatusTrail', () => {
  it('lists only events the server actually sent, in order', () => {
    render(
      <MotionProvider>
        <StatusTrail events={['connected', 'understanding_question', 'generating_sql']} />
      </MotionProvider>,
    )
    const steps = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(steps).toEqual(['Understanding the question', 'Writing SQL'])
  })

  it('renders nothing before the first real status arrives', () => {
    const { container } = render(
      <MotionProvider>
        <StatusTrail events={['connected']} />
      </MotionProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
