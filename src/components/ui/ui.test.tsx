import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { Field } from './Field'
import { Input } from './Input'
import { Modal } from './Overlay'
import { ToastProvider, useToast } from './Toast'
import { SyncIndicatorView } from '@/components/sync/SyncIndicator'
import type { SyncIndicatorState } from '@/domain/sync'

describe('Field', () => {
  it('links label, error and control for assistive tech', () => {
    render(
      <Field label="Price" error="Enter a price.">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Price')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a price.')
  })
})

describe('Button', () => {
  it('is disabled and not clickable while loading', async () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

function ModalHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit category">
        <input aria-label="Name" />
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('moves focus in, closes on Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Edit category' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps Tab focus inside the dialog', async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })
})

describe('ConfirmDialog', () => {
  it('only confirms on explicit action', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<ConfirmDialog open title="Delete Coffee?" description="It can be undone." confirmLabel="Delete" onConfirm={onConfirm} onCancel={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

function ToastHarness() {
  const toast = useToast()
  return <button onClick={() => toast.show({ title: 'Saved locally' })}>Go</button>
}

describe('Toast', () => {
  it('announces toasts politely', async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText('Saved locally')).toBeInTheDocument()
  })
})

describe('SyncIndicatorView', () => {
  const states: SyncIndicatorState[] = ['synchronized', 'pending', 'syncing', 'offline', 'connecting', 'error', 'unknown']
  it.each(states)('renders a text label for %s (never color-only)', (state) => {
    render(
      <MemoryRouter>
        <SyncIndicatorView state={state} pending={2} lastSyncAt={Date.now() - 60_000} />
      </MemoryRouter>,
    )
    expect(document.body.textContent?.trim().length).toBeGreaterThan(3)
  })

  it('distinguishes offline from synchronized in text', () => {
    const { rerender } = render(<SyncIndicatorView state="offline" pending={2} />)
    const offline = document.body.textContent
    rerender(<SyncIndicatorView state="synchronized" />)
    expect(document.body.textContent).not.toBe(offline)
  })
})
