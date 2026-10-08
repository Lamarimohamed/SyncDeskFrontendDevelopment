import type { FormEvent, ReactNode } from 'react'
import { Field } from '@/components/ui/Field'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { PRODUCT_LIMITS } from '@/domain/rules'
import type { Availability, CategoryRecord, ProductInput } from '@/domain/types'

export interface ProductFormValues {
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  price: string
  categoryId: string
  availability: Availability
  stock: string
  lowStockThreshold: string
}

export const EMPTY_FORM: ProductFormValues = {
  name: '',
  nameAr: '',
  description: '',
  descriptionAr: '',
  price: '',
  categoryId: '',
  availability: 'available',
  stock: '0',
  lowStockThreshold: '5',
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

export function toInput(v: ProductFormValues): ProductInput {
  return {
    name: v.name.trim(),
    nameAr: v.nameAr.trim(),
    description: v.description.trim(),
    descriptionAr: v.descriptionAr.trim(),
    price: num(v.price),
    categoryId: v.categoryId,
    availability: v.availability,
    stock: num(v.stock),
    lowStockThreshold: num(v.lowStockThreshold),
  }
}

export function fromProduct(p: ProductInput): ProductFormValues {
  return {
    name: p.name,
    nameAr: p.nameAr,
    description: p.description,
    descriptionAr: p.descriptionAr,
    price: String(p.price),
    categoryId: p.categoryId,
    availability: p.availability,
    stock: String(p.stock),
    lowStockThreshold: String(p.lowStockThreshold),
  }
}

interface Props {
  values: ProductFormValues
  errors: Partial<Record<keyof ProductFormValues, string>>
  categories: CategoryRecord[]
  disabled?: boolean
  stockNote?: ReactNode
  onChange: <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => void
  onBlur: (key: keyof ProductFormValues) => void
  onSubmit: (e: FormEvent) => void
  actions: ReactNode
}

export function ProductForm({ values, errors, categories, disabled, stockNote, onChange, onBlur, onSubmit, actions }: Props) {
  const bind = (key: keyof ProductFormValues) => ({
    value: values[key],
    disabled,
    onBlur: () => onBlur(key),
  })
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="type-h3 mb-3 text-fg">Product</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name}>
            <Input {...bind('name')} maxLength={PRODUCT_LIMITS.name + 20} autoComplete="off" onChange={(e) => onChange('name', e.target.value)} />
          </Field>
          <Field label="Arabic name" optional>
            <Input {...bind('nameAr')} dir="rtl" lang="ar" autoComplete="off" onChange={(e) => onChange('nameAr', e.target.value)} />
          </Field>
          <Field label="Description" optional error={errors.description} helper={`${values.description.length} / ${PRODUCT_LIMITS.description}`}>
            <Textarea {...bind('description')} onChange={(e) => onChange('description', e.target.value)} />
          </Field>
          <Field label="Arabic description" optional>
            <Textarea {...bind('descriptionAr')} dir="rtl" lang="ar" onChange={(e) => onChange('descriptionAr', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="type-h3 mb-3 text-fg">Pricing and availability</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price (DA)" error={errors.price} helper="Whole dinars. Works offline.">
            <Input {...bind('price')} type="number" inputMode="numeric" min={0} step={1} className="tabular" onChange={(e) => onChange('price', e.target.value)} />
          </Field>
          <Field label="Category" error={errors.categoryId}>
            <Select {...bind('categoryId')} onChange={(e) => onChange('categoryId', e.target.value)}>
              <option value="">Choose a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Availability" helper="Whether it can be sold.">
            <Select {...bind('availability')} onChange={(e) => onChange('availability', e.target.value as Availability)}>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="type-h3 mb-3 text-fg">Stock</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Stock on hand" error={errors.stock} helper={stockNote}>
            <Input {...bind('stock')} type="number" inputMode="numeric" step={1} className="tabular" onChange={(e) => onChange('stock', e.target.value)} />
          </Field>
          <Field label="Low-stock threshold" error={errors.lowStockThreshold} helper="Flagged as low at or below this.">
            <Input {...bind('lowStockThreshold')} type="number" inputMode="numeric" min={0} step={1} className="tabular" onChange={(e) => onChange('lowStockThreshold', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">{actions}</div>
    </form>
  )
}
