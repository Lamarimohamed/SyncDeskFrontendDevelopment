import { useState, type FormEvent } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Overlay'
import { StockBadge } from '@/components/ui/StatusBadge'
import { adjustmentDelta, stockLevel, validateAdjustment } from '@/domain/rules'
import {
  ValidationError,
  type AdjustmentReason,
  type AdjustmentType,
  type ProductRecord,
  type StockAdjustment,
} from '@/domain/types'
import { cn } from '@/lib/cn'
import { repository } from '@/services/container'

interface Props {
  open: boolean
  products: ProductRecord[]
  initialProductId?: string
  onClose: () => void
  onSaved: (adjustment: StockAdjustment, product: ProductRecord) => void
}

const TYPES: { value: AdjustmentType; label: string; hint: string }[] = [
  { value: 'add', label: 'Add', hint: 'Received or returned' },
  { value: 'remove', label: 'Remove', hint: 'Sold, wasted or lost' },
  { value: 'correct', label: 'Correct', hint: 'Set to a counted total' },
]

const DEFAULT_REASON: Record<AdjustmentType, AdjustmentReason> = { add: 'restock', remove: 'sale', correct: 'correction' }
const REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: 'restock', label: 'Restock' },
  { value: 'sale', label: 'Sale' },
  { value: 'waste', label: 'Waste' },
  { value: 'correction', label: 'Correction' },
]

function AdjustForm({ products, initialProductId, saving, setSaving, onSaved }: Omit<Props, 'open' | 'onClose'> & { saving: boolean; setSaving: (v: boolean) => void }) {
  const [productId, setProductId] = useState(products.some((p) => p.id === initialProductId) ? (initialProductId as string) : '')
  const [type, setType] = useState<AdjustmentType>('add')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<AdjustmentReason>('restock')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  const product = products.find((p) => p.id === productId)
  const qty = quantity.trim() === '' ? Number.NaN : Number(quantity)
  const input = { productId, type, quantity: qty, reason, notes: notes.trim() }
  const found = validateAdjustment(input)
  const productError = !productId ? 'Choose a product.' : undefined
  const show = (msg?: string) => (touched ? msg : undefined)

  const valid = Boolean(product) && Object.keys(found).length === 0
  const current = product?.stock ?? 0
  const delta = valid ? adjustmentDelta(type, qty, current) : null
  const resulting = delta === null ? null : current + delta
  const negative = resulting !== null && resulting < 0

  function changeType(next: AdjustmentType) {
    setType(next)
    setReason((r) => (next === 'correct' ? 'correction' : r === 'correction' ? DEFAULT_REASON[next] : r))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setFormError(null)
    if (!product || productError || Object.keys(found).length > 0) return
    setSaving(true)
    try {
      const adj = await repository.adjustStock(input)
      setSaving(false)
      onSaved(adj, product)
    } catch (err) {
      setSaving(false)
      if (err instanceof ValidationError) {
        setServerErrors(err.fieldErrors)
        setFormError(err.message)
      } else setFormError(err instanceof Error ? err.message : 'The adjustment could not be saved.')
    }
  }

  return (
    <>
      <form id="adjust-form" onSubmit={submit} noValidate className="space-y-5">
        {formError ? <Banner tone="error" title="The adjustment was not saved">{formError}</Banner> : null}
        <Field label="Product" error={show(productError)}>
          <Select
            value={productId}
            disabled={saving}
            data-autofocus
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Choose a product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset disabled={saving}>
          <legend className="type-label mb-1.5 text-fg">Adjustment type</legend>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <label
                key={t.value}
                className={cn(
                  'cursor-pointer rounded-input border px-3 py-2 text-start transition-colors duration-150 has-focus-visible:outline-2',
                  type === t.value ? 'border-primary bg-primary-soft' : 'border-line-strong hover:bg-subtle',
                )}
              >
                <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => changeType(t.value)} className="sr-only" />
                <span className={cn('type-label block', type === t.value ? 'text-primary-text' : 'text-fg')}>{t.label}</span>
                <span className="type-caption block text-muted">{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={type === 'correct' ? 'Counted stock' : 'Quantity'}
            error={show(found.quantity ?? serverErrors.quantity)}
          >
            <Input
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              className="tabular"
              value={quantity}
              disabled={saving}
              onChange={(e) => {
                setQuantity(e.target.value)
                setServerErrors({})
              }}
              onBlur={() => setTouched(true)}
            />
          </Field>
          <Field label="Reason" error={show(found.reason ?? serverErrors.reason)}>
            <Select value={reason} disabled={saving || type === 'correct'} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notes" optional>
          <Textarea value={notes} rows={2} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <section aria-label="Preview" className="rounded-card bg-subtle p-4">
          <h3 className="type-label text-fg2">Preview</h3>
          {product ? (
            <p className="type-body mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular text-fg2">{current}</span>
              <span aria-hidden className="text-muted">→</span>
              <span className="sr-only">becomes</span>
              <span className="tabular type-h2 text-fg">{resulting ?? '–'}</span>
              {resulting !== null ? <StockBadge level={stockLevel(resulting, product.lowStockThreshold)} /> : null}
            </p>
          ) : (
            <p className="type-body-sm mt-1 text-muted">Choose a product and a quantity to see the result.</p>
          )}
          {delta !== null ? (
            <p className="type-caption tabular mt-1 text-muted">Change: {delta > 0 ? '+' : ''}{delta}</p>
          ) : null}
        </section>

        {negative ? (
          <Banner tone="warning" title="This leaves stock below zero and needs reconciliation">
            Your device allows it. Devices working offline can each remove stock they have not seen removed elsewhere. Stock counts are merged
            additively, so the total can go below zero until someone counts the shelf and corrects it. The product will be flagged as needing
            reconciliation.
          </Banner>
        ) : null}
      </form>
    </>
  )
}

export function AdjustStockDrawer({ open, ...rest }: Props) {
  const [saving, setSaving] = useState(false)
  return (
    <Drawer
      open={open}
      onClose={saving ? () => {} : rest.onClose}
      dismissible={!saving}
      title="Adjust stock"
      description="Recorded on this device first, then synchronized."
      footer={
        <>
          <Button onClick={rest.onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="adjust-form" variant="primary" loading={saving}>
            Save adjustment
          </Button>
        </>
      }
    >
      <AdjustForm products={rest.products} initialProductId={rest.initialProductId} onSaved={rest.onSaved} saving={saving} setSaving={setSaving} />
    </Drawer>
  )
}
