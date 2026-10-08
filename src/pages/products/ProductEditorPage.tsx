import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router'
import { Package } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { useSyncSnapshot } from '@/hooks/useSync'
import { validateProduct } from '@/domain/rules'
import { ValidationError } from '@/domain/types'
import { repository } from '@/services/container'
import { EMPTY_FORM, ProductForm, fromProduct, toInput, type ProductFormValues } from './ProductForm'

type SaveState = 'idle' | 'saving' | 'saved-locally'
type Errors = Partial<Record<keyof ProductFormValues, string>>

export function ProductEditorPage() {
  const { productId } = useParams()
  const isEdit = Boolean(productId)
  const navigate = useNavigate()
  const toast = useToast()
  const { connectivity } = useSyncSnapshot()

  const categories = useRepositoryQuery(() => repository.getCategories())
  const product = useRepositoryQuery(
    () => (productId ? repository.getProduct(productId) : Promise.resolve(undefined)),
    [productId],
  )

  const [values, setValues] = useState<ProductFormValues>(EMPTY_FORM)
  const [baseline, setBaseline] = useState<ProductFormValues>(EMPTY_FORM)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [touched, setTouched] = useState<Partial<Record<keyof ProductFormValues, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const bypass = useRef(false)

  // Populate the form once per product; later silent refreshes must not overwrite edits.
  useEffect(() => {
    if (product.data && loadedFor !== product.data.id) {
      const v = fromProduct(product.data)
      setValues(v)
      setBaseline(v)
      setLoadedFor(product.data.id)
    }
  }, [product.data, loadedFor])

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => !bypass.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const clientErrors = validateProduct(toInput(values))
  const errors: Errors = {}
  for (const key of Object.keys(values) as (keyof ProductFormValues)[]) {
    const msg = serverErrors[key] ?? clientErrors[key]
    if (msg && (touched[key] || submitted || serverErrors[key])) errors[key] = msg
  }

  function change<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setSaveState('idle')
    if (serverErrors[key]) setServerErrors((s) => ({ ...s, [key]: undefined }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setFormError(null)
    const found = validateProduct(toInput(values))
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus())
      return
    }
    setSaveState('saving')
    try {
      const saved = isEdit && productId
        ? await repository.updateProduct(productId, toInput(values))
        : await repository.createProduct(toInput(values))
      setSaveState('saved-locally')
      bypass.current = true
      toast.show({
        title: 'Saved locally',
        description:
          connectivity === 'offline'
            ? 'This device is offline. The change will synchronize when it reconnects.'
            : 'Synchronization is pending.',
        tone: 'success',
      })
      navigate(`/products/${saved.id}`)
    } catch (err) {
      setSaveState('idle')
      if (err instanceof ValidationError) {
        setServerErrors(err.fieldErrors as Errors)
        setFormError(err.message)
      } else {
        setFormError(err instanceof Error ? err.message : 'The product could not be saved.')
      }
    }
  }

  const title = isEdit ? 'Edit product' : 'New product'
  const crumbs = [
    { label: 'Products', to: '/products' },
    ...(isEdit && product.data ? [{ label: product.data.name, to: `/products/${product.data.id}` }] : []),
    { label: isEdit ? 'Edit' : 'New' },
  ]
  const cancelTo = isEdit && productId ? `/products/${productId}` : '/products'

  let body
  if (isEdit && product.status === 'error') {
    body =
      product.error?.name === 'NotFoundError' ? (
        <EmptyState
          icon={Package}
          title="This product does not exist on this device"
          description="It may have been deleted here or on another device."
          actions={<ButtonLink variant="primary" to="/products">Back to products</ButtonLink>}
        />
      ) : (
        <ErrorState title="This product could not be loaded" description={product.error?.message} reassurance="Nothing was lost. Your data on this device is unchanged." onRetry={product.reload} />
      )
  } else if (categories.status === 'error') {
    body = <ErrorState title="Categories could not be loaded" description={categories.error?.message} onRetry={categories.reload} />
  } else if ((isEdit && !loadedFor) || categories.status === 'loading') {
    body = (
      <CardBody>
        <div role="status" aria-label="Loading form" className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </CardBody>
    )
  } else {
    const cats = categories.data ?? []
    body = (
      <CardBody>
        {cats.length === 0 ? (
          <Banner
            tone="warning"
            title="No categories yet"
            className="mb-6"
            action={<ButtonLink size="sm" to="/categories">Create a category</ButtonLink>}
          >
            A product needs a category. Create one first.
          </Banner>
        ) : null}
        {formError ? (
          <Banner tone="error" title="The product was not saved" className="mb-6">
            {formError}
          </Banner>
        ) : null}
        <ProductForm
          values={values}
          errors={errors}
          categories={cats}
          disabled={saveState === 'saving'}
          stockNote={isEdit ? 'To record why stock changed, use Adjust stock instead.' : undefined}
          onChange={change}
          onBlur={(k) => setTouched((t) => ({ ...t, [k]: true }))}
          onSubmit={submit}
          actions={
            <>
              <Button type="submit" variant="primary" loading={saveState === 'saving'}>
                {saveState === 'saving' ? 'Saving' : isEdit ? 'Save changes' : 'Create product'}
              </Button>
              <ButtonLink to={cancelTo}>Cancel</ButtonLink>
              <p role="status" aria-live="polite" className="type-body-sm text-fg2 sm:ms-2">
                {saveState === 'saved-locally'
                  ? 'Saved locally'
                  : dirty
                    ? 'Unsaved changes'
                    : ''}
              </p>
            </>
          }
        />
      </CardBody>
    )
  }

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={crumbs}
        description="Saved on this device first, then synchronized. Editing works while offline."
      />
      <Card className="max-w-3xl">{body}</Card>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        description="Your changes to this product have not been saved on this device."
        confirmLabel="Discard changes"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </>
  )
}
