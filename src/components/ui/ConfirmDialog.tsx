import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Overlay'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, description, children, confirmLabel, tone = 'danger', loading, error, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button onClick={onCancel} disabled={loading} data-autofocus>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="type-body space-y-3 text-fg2">
        {children}
        {error ? (
          <p role="alert" className="type-body-sm rounded-control bg-error-soft px-3 py-2 text-error-fg">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
