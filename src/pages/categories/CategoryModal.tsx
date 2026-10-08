import { useEffect, useState, type FormEvent } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Overlay'
import { validateCategoryName } from '@/domain/rules'
import { ValidationError, type CategoryInput, type CategoryRecord } from '@/domain/types'
import { repository } from '@/services/container'

interface Props {
  open: boolean
  category: CategoryRecord | null
  onClose: () => void
  onSaved: (category: CategoryRecord, created: boolean) => void
}

export function CategoryModal({ open, category, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CategoryInput>({ name: '', nameAr: '', description: '' })
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(category ? { name: category.name, nameAr: category.nameAr, description: category.description } : { name: '', nameAr: '', description: '' })
    setTouched(false)
    setServerError(null)
    setFormError(null)
    setSaving(false)
  }, [open, category])

  const nameError = serverError ?? (touched ? validateCategoryName(form.name) : undefined)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setFormError(null)
    if (validateCategoryName(form.name)) return
    setSaving(true)
    try {
      const input = { ...form, name: form.name.trim(), nameAr: form.nameAr.trim(), description: form.description.trim() }
      const saved = category ? await repository.updateCategory(category.id, input) : await repository.createCategory(input)
      onSaved(saved, !category)
    } catch (err) {
      setSaving(false)
      if (err instanceof ValidationError) {
        if (err.fieldErrors.name) setServerError(err.fieldErrors.name)
        else setFormError(err.message)
      } else setFormError(err instanceof Error ? err.message : 'The category could not be saved.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      title={category ? 'Edit category' : 'New category'}
      description="Saved on this device first, then synchronized."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="category-form" variant="primary" loading={saving}>
            {category ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} noValidate className="space-y-4">
        {formError ? <Banner tone="error" title="The category was not saved">{formError}</Banner> : null}
        <Field label="Name" error={nameError}>
          <Input
            value={form.name}
            data-autofocus
            autoComplete="off"
            onChange={(e) => {
              setServerError(null)
              setForm({ ...form, name: e.target.value })
            }}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <Field label="Arabic name" optional>
          <Input value={form.nameAr} dir="rtl" lang="ar" autoComplete="off" onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
        </Field>
        <Field label="Description" optional>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </form>
    </Modal>
  )
}
