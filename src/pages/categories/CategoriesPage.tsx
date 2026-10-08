import { useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { EntitySyncBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import type { CategoryRecord } from '@/domain/types'
import { plural } from '@/lib/format'
import { repository } from '@/services/container'
import { CategoryModal } from './CategoryModal'

export function CategoriesPage() {
  const toast = useToast()
  const query = useRepositoryQuery(() => repository.getCategories())
  const [editing, setEditing] = useState<{ category: CategoryRecord | null } | null>(null)
  const [toDelete, setToDelete] = useState<CategoryRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const categories = query.data ?? []

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await repository.deleteCategory(toDelete.id)
      toast.show({ title: `Deleted "${toDelete.name}"`, description: 'Saved locally. It will synchronize later.', tone: 'success' })
      setToDelete(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'The category could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  const newButton = (
    <Button variant="primary" icon={<Plus aria-hidden className="size-4" />} onClick={() => setEditing({ category: null })}>
      New category
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products so they are easier to find. Changes are saved on this device first."
        actions={newButton}
      />
      <Card>
        {query.status === 'loading' ? (
          <ListSkeleton rows={5} label="Loading categories" />
        ) : query.status === 'error' ? (
          <ErrorState
            title="Categories could not be loaded"
            description={query.error?.message}
            reassurance="Nothing was lost. Your data on this device is unchanged."
            onRetry={query.reload}
          />
        ) : categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Create a category before adding products. Every product belongs to one."
            next="It is saved locally and synchronized when a connection is available."
            actions={newButton}
          />
        ) : (
          <ul aria-label="Categories" className="divide-y divide-line">
            {categories.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3 sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="type-label text-fg">
                    {c.name}
                    {c.nameAr ? (
                      <span dir="rtl" lang="ar" className="ms-2 font-normal text-muted">{c.nameAr}</span>
                    ) : null}
                  </p>
                  {c.description ? <p className="type-body-sm mt-0.5 text-fg2">{c.description}</p> : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:hidden">
                    <span className="type-caption tabular text-muted">{plural(c.productCount, 'product')}</span>
                    <EntitySyncBadge state={c.syncState} />
                  </div>
                </div>
                <span className="type-body-sm tabular hidden w-24 text-end text-fg2 sm:block">{plural(c.productCount, 'product')}</span>
                <span className="hidden w-32 sm:block"><EntitySyncBadge state={c.syncState} /></span>
                <Dropdown
                  label={`Actions for ${c.name}`}
                  triggerClassName="inline-flex size-9 items-center justify-center rounded-control text-fg2 hover:bg-subtle hover:text-fg max-sm:size-11"
                  trigger={<MoreHorizontal aria-hidden className="size-4" />}
                  items={[
                    { label: 'Edit', icon: Pencil, onSelect: () => setEditing({ category: c }) },
                    'separator',
                    { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => { setDeleteError(null); setToDelete(c) } },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CategoryModal
        open={editing !== null}
        category={editing?.category ?? null}
        onClose={() => setEditing(null)}
        onSaved={(c, created) => {
          setEditing(null)
          toast.show({ title: `${created ? 'Created' : 'Updated'} "${c.name}"`, description: 'Saved locally. Synchronization is pending.', tone: 'success' })
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete ? `Delete "${toDelete.name}"?` : 'Delete category?'}
        description="Categories that products still use cannot be deleted."
        confirmLabel="Delete category"
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        {toDelete && toDelete.productCount > 0 ? (
          <p>
            {plural(toDelete.productCount, 'product')} still {toDelete.productCount === 1 ? 'uses' : 'use'} this category. Move or delete
            {toDelete.productCount === 1 ? ' it' : ' them'} first.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
