import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Package, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SaveStatus } from '@/components/sync/SaveStatus'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { AvailabilityBadge, EntitySyncBadge, StockBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { usePendingFor, useSyncSnapshot } from '@/hooks/useSync'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import type { ProductRecord } from '@/domain/types'
import { formatDA, formatDateTime, relativeTime } from '@/lib/format'
import { repository } from '@/services/container'

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="space-y-4">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2.5">
      <dt className="type-body-sm text-muted">{label}</dt>
      <dd className="type-body col-span-2 min-w-0 text-fg">{children}</dd>
    </div>
  )
}

function ProductBody({ product }: { product: ProductRecord }) {
  const pending = usePendingFor(product.id)
  const { conflicts } = useSyncSnapshot()
  const history = useRepositoryQuery(() => repository.getStockHistory(product.id), [product.id])
  const productConflicts = conflicts.filter((c) => c.entityLabel === product.name)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Details" action={<EntitySyncBadge state={product.syncState} />} />
          <CardBody>
            <dl className="divide-y divide-line">
              <Row label="Name">{product.name}</Row>
              <Row label="Arabic name">
                <span dir="rtl" lang="ar">{product.nameAr || <span className="text-muted">Not set</span>}</span>
              </Row>
              <Row label="Description">{product.description || <span className="text-muted">No description</span>}</Row>
              <Row label="Arabic description">
                <span dir="rtl" lang="ar">{product.descriptionAr || <span className="text-muted">Not set</span>}</span>
              </Row>
              <Row label="Category">{product.categoryName}</Row>
              <Row label="Price"><span className="tabular font-medium">{formatDA(product.price)}</span></Row>
              <Row label="Availability"><AvailabilityBadge value={product.availability} /></Row>
              <Row label="Last changed">{formatDateTime(product.updatedAt)}</Row>
            </dl>
          </CardBody>
        </Card>

        {productConflicts.length > 0 ? (
          <Card>
            <CardHeader
              title="Conflicts on this product"
              description="Two devices changed the same field while disconnected."
            />
            <ul className="divide-y divide-line">
              {productConflicts.map((c) => (
                <li key={c.id} className="space-y-3 px-4 py-4 sm:px-5">
                  <p className="type-label text-fg">
                    {c.field} · detected {relativeTime(c.at)}
                  </p>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="type-caption text-muted">Local value</dt>
                      <dd className="type-body tabular text-fg">{c.local}</dd>
                      <dd className="type-caption text-muted">this device, {formatDateTime(c.localAt)}</dd>
                    </div>
                    <div>
                      <dt className="type-caption text-muted">Remote value</dt>
                      <dd className="type-body tabular text-fg">{c.remote}</dd>
                      <dd className="type-caption text-muted">{c.remoteDevice}, {formatDateTime(c.remoteAt)}</dd>
                    </div>
                    <div>
                      <dt className="type-caption text-muted">Result</dt>
                      <dd className="type-body tabular font-medium text-fg">{c.result}</dd>
                      <dd className="type-caption text-muted">{c.winner === 'local' ? 'Local change kept' : 'Remote change kept'}</dd>
                    </div>
                  </dl>
                  <p className="type-body-sm rounded-control bg-subtle px-3 py-2 text-fg2">
                    <span className="font-medium text-fg">Rule: </span>
                    {c.rule} Last-writer-wins: the later change replaced the other; the earlier value is not kept as a second value.
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Recent stock history" description="Adjustments recorded for this product." />
          {history.status === 'loading' ? (
            <div role="status" aria-label="Loading stock history" className="space-y-3 p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : history.status === 'error' ? (
            <ErrorState title="Stock history could not be loaded" onRetry={history.reload} />
          ) : (history.data ?? []).length === 0 ? (
            <EmptyState compact icon={SlidersHorizontal} title="No stock movements yet" description="Adjustments made for this product will be listed here." />
          ) : (
            <ul className="divide-y divide-line">
              {(history.data ?? []).slice(0, 8).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="type-body text-fg capitalize">
                      {h.reason} <span className="text-muted">· {h.type}</span>
                    </p>
                    <p className="type-caption text-muted">
                      {formatDateTime(h.createdAt)}
                      {h.notes ? ` · ${h.notes}` : ''}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className={`type-body tabular font-medium ${h.delta < 0 ? 'text-error-fg' : 'text-fg'}`}>
                      {h.delta > 0 ? '+' : ''}{h.delta}
                    </p>
                    <p className="type-caption tabular text-muted">now {h.resultingStock}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Stock" />
          <CardBody className="space-y-3">
            <p className="type-metric text-fg">{product.stock}</p>
            <div className="flex flex-wrap items-center gap-2">
              <StockBadge level={product.stockLevel} />
              <span className="type-caption text-muted">Low-stock threshold {product.lowStockThreshold}</span>
            </div>
            {product.stockLevel === 'negative' ? (
              <p className="type-body-sm text-error-fg">
                More stock was removed than was recorded, likely by devices working offline. Count the shelf and correct the stock.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Synchronization" />
          <CardBody className="space-y-3">
            <SaveStatus entityId={product.id} />
            {pending.length > 0 ? (
              <ul className="space-y-2" aria-label="Pending changes">
                {pending.map((p) => (
                  <li key={p.id} className="rounded-control bg-subtle px-3 py-2">
                    <p className="type-body-sm text-fg">{p.summary}</p>
                    <p className="type-caption text-muted">
                      {p.crdt} · {relativeTime(p.createdAt)}
                      {p.status === 'failed' ? ' · failed' : ''}
                    </p>
                    {p.from !== undefined && p.to !== undefined ? (
                      <p className="type-caption tabular text-fg2">{p.from} to {p.to}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-body-sm text-muted">No pending changes for this product.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

export function ProductDetailPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const query = useRepositoryQuery(() => repository.getProduct(productId ?? ''), [productId])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const product = query.data
  const notFound = query.status === 'error' && query.error?.name === 'NotFoundError'

  async function confirmDelete() {
    if (!product) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const removed = await repository.deleteProduct(product.id)
      setConfirmOpen(false)
      toast.show({
        title: `Deleted "${removed.name}"`,
        description: 'Saved locally. It will synchronize when a connection is available.',
        tone: 'success',
        action: {
          label: 'Undo',
          onAction: () => {
            repository.restoreProduct(removed).then(
              () => toast.show({ title: `Restored "${removed.name}"`, tone: 'success' }),
              (e: unknown) => toast.show({ title: 'Could not restore the product', description: e instanceof Error ? e.message : undefined, tone: 'error' }),
            )
          },
        },
      })
      navigate('/products')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'The product could not be deleted.')
      setDeleting(false)
    }
  }

  if (notFound) {
    return (
      <>
        <PageHeader title="Product not found" breadcrumbs={[{ label: 'Products', to: '/products' }, { label: 'Not found' }]} />
        <Card>
          <EmptyState
            icon={Package}
            title="This product does not exist on this device"
            description="It may have been deleted here or on another device, or the link is wrong."
            actions={<ButtonLink variant="primary" to="/products">Back to products</ButtonLink>}
          />
        </Card>
      </>
    )
  }

  if (query.status === 'error') {
    return (
      <>
        <PageHeader title="Product" breadcrumbs={[{ label: 'Products', to: '/products' }, { label: 'Error' }]} />
        <Card>
          <ErrorState
            title="This product could not be loaded"
            description={query.error?.message}
            reassurance="Nothing was lost. Your data on this device is unchanged."
            onRetry={query.reload}
          />
        </Card>
      </>
    )
  }

  if (!product) {
    return (
      <>
        <PageHeader title="Product" documentTitle="Product" />
        <DetailSkeleton />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={product.name}
        breadcrumbs={[{ label: 'Products', to: '/products' }, { label: product.name }]}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Badge>{product.categoryName}</Badge>
            <SaveStatus entityId={product.id} />
          </div>
        }
        actions={
          <>
            <ButtonLink to={`/stock/adjust?product=${product.id}`} icon={<SlidersHorizontal aria-hidden className="size-4" />}>
              Adjust stock
            </ButtonLink>
            <ButtonLink to={`/products/${product.id}/edit`} icon={<Pencil aria-hidden className="size-4" />}>
              Edit
            </ButtonLink>
            <Button variant="ghost" icon={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirmOpen(true)}>
              Delete
            </Button>
          </>
        }
      />
      <ProductBody product={product} />
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete "${product.name}"?`}
        description="The product is removed from this device now and the deletion synchronizes later. You can undo right after."
        confirmLabel="Delete product"
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
