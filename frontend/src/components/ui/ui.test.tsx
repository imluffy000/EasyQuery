import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MotionProvider } from '@/components/motion'
import { Button, ConfirmDelete, ConfirmDialog } from '@/components/ui'
import { setMedia } from '@/test/setup'

describe('Button', () => {
  it('does not fire while loading, and says it is busy', async () => {
    const onClick = vi.fn()
    render(
      <MotionProvider>
        <Button loading onClick={onClick}>
          Save
        </Button>
      </MotionProvider>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('activates from the keyboard', async () => {
    const onClick = vi.fn()
    render(
      <MotionProvider>
        <Button onClick={onClick}>Run</Button>
      </MotionProvider>,
    )
    screen.getByRole('button', { name: 'Run' }).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})

function DeleteHarness({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <ConfirmDelete
      label="Delete term revenue"
      onConfirm={onConfirm}
      confirming={confirming}
      setConfirming={setConfirming}
    />
  )
}

describe('ConfirmDelete', () => {
  it('asks first, and puts focus on Cancel rather than Confirm', async () => {
    setMedia({ reducedMotion: true })
    const onConfirm = vi.fn()
    render(
      <MotionProvider>
        <DeleteHarness onConfirm={onConfirm} />
      </MotionProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete term revenue' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel delete' })).toHaveFocus())
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete term revenue' })).toHaveFocus(),
    )
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('deletes only after the explicit confirm', async () => {
    setMedia({ reducedMotion: true })
    const onConfirm = vi.fn()
    render(
      <MotionProvider>
        <DeleteHarness onConfirm={onConfirm} />
      </MotionProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete term revenue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('ConfirmDialog', () => {
  it('renders into document.body so a transformed ancestor cannot misplace it', () => {
    render(
      <MotionProvider>
        <div data-testid="card" style={{ transform: 'translateY(-2px)' }}>
          <ConfirmDialog title="Remove?" confirmLabel="Remove" onConfirm={vi.fn()} onCancel={vi.fn()} />
        </div>
      </MotionProvider>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Remove?' })
    expect(screen.getByTestId('card')).not.toContainElement(dialog)
  })

  it('closes on Escape and moves focus into the dialog', async () => {
    const onCancel = vi.fn()
    render(
      <MotionProvider>
        <ConfirmDialog title="Log out" confirmLabel="Log out" onConfirm={vi.fn()} onCancel={onCancel} />
      </MotionProvider>,
    )
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
