import { buildSeed, PEER_SEEDS, THIS_DEVICE_ID, type Seed } from '@/data/seed'
import { stockLevel, adjustmentDelta, validateAdjustment, validateCategoryName, validateProduct } from '@/domain/rules'
import type { ChangeDraft, RemoteChange, SyncSnapshot } from '@/domain/sync'
import { compareRetailVersions, type RetailCatalog, type RetailVersion, type VersionedRetailOperation } from '@/domain/retailSync'
import {
  RepositoryError,
  ValidationError,
  type Category,
  type CategoryInput,
  type CategoryRecord,
  type Device,
  type EntitySyncState,
  type Product,
  type ProductInput,
  type ProductRecord,
  type StockAdjustment,
  type StockAdjustmentInput,
  type StockRow,
} from '@/domain/types'
import { formatDA } from '@/lib/format'
import { nextId } from '@/lib/ids'
import { logger } from '@/lib/logger'
import { readJson, writeJson, type KeyValueStorage } from '@/lib/storage'
import type { SyncEngine } from '@/services/sync/SyncEngine'
import type { ReplicaStats, Repository } from './Repository'

interface DataSet {
  categories: Category[]
  products: Product[]
  adjustments: StockAdjustment[]
  /** Identifiers of removed products; kept so removals can propagate. */
  tombstones: string[]
  versioned?: {
    applied: string[]
    productFields: Record<string, Record<string, RetailVersion>>
    productTombstones: Record<string, RetailVersion>
    productRestores: Record<string, RetailVersion>
    categoryFields: Record<string, Record<string, RetailVersion>>
    categoryTombstones: Record<string, RetailVersion>
  }
}

const DATA_KEY = 'syncdesk.data.v1'

export class NotFoundError extends RepositoryError {
  constructor(what: string) {
    super(`${what} was not found in the local workspace.`)
    this.name = 'NotFoundError'
  }
}

export interface MockRepositoryOptions {
  latencyMs?: number
  now?: () => number
}

export class MockRepository implements Repository {
  private data: DataSet
  private listeners = new Set<() => void>()
  private readonly latencyMs: number
  private readonly now: () => number
  private failReads = false

  constructor(
    private readonly engine: SyncEngine,
    private readonly storage: KeyValueStorage,
    seed: Seed = buildSeed(Date.now()),
    options: MockRepositoryOptions = {},
  ) {
    this.latencyMs = options.latencyMs ?? 300
    this.now = options.now ?? Date.now
    this.data = readJson<DataSet | null>(storage, DATA_KEY, null) ?? {
      categories: seed.categories,
      products: seed.products,
      adjustments: seed.adjustments,
      tombstones: [],
    }
    this.data.versioned ??= { applied: [], productFields: {}, productTombstones: {}, productRestores: {}, categoryFields: {}, categoryTombstones: {} }
    engine.subscribe(() => this.emit())
    engine.setMergeHandler((change) => this.applyRemote(change))
    engine.setVersionedOperationHandler((operation, source) => this.applyVersionedOperation(operation, source))
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /* ----- development controls ----- */

  setFailReads(value: boolean): void {
    this.failReads = value
    this.emit()
  }
  isFailingReads(): boolean {
    return this.failReads
  }
  resetDemoData(): void {
    const seed = buildSeed(this.now())
    this.data = { categories: seed.categories, products: seed.products, adjustments: seed.adjustments, tombstones: [] }
    this.commit()
  }

  hydrateCatalog = (catalog: RetailCatalog) =>
    this.write(() => {
      const pendingProductIds = new Set(
        this.engine.getSnapshot().pending
          .filter((change) => change.entityType === 'product' || change.entityType === 'stock')
          .map((change) => change.entityId),
      )
      const pendingCategoryIds = new Set(
        this.engine.getSnapshot().pending.filter((change) => change.entityType === 'category').map((change) => change.entityId),
      )
      const remoteProductIds = new Set(catalog.products.map((product) => product.id))
      const remoteCategoryIds = new Set(catalog.categories.map((category) => category.id))
      const remotelyDeletedProductIds = this.data.products
        .filter((product) => !pendingProductIds.has(product.id) && !remoteProductIds.has(product.id))
        .map((product) => product.id)
      this.data.tombstones = [...new Set([...this.data.tombstones, ...remotelyDeletedProductIds])]

      this.data.products = [
        ...this.data.products.filter((product) => pendingProductIds.has(product.id) || remoteProductIds.has(product.id)),
        ...catalog.products.filter(
          (product) => !pendingProductIds.has(product.id) && !this.data.products.some((local) => local.id === product.id),
        ),
      ]
        .map((product) => {
          if (pendingProductIds.has(product.id)) return product
          return catalog.products.find((remote) => remote.id === product.id) ?? product
        })
        .filter((product) => pendingProductIds.has(product.id) || remoteProductIds.has(product.id))
      this.data.tombstones = this.data.tombstones.filter((id) => !remoteProductIds.has(id))

      this.data.categories = [
        ...this.data.categories.filter((category) => pendingCategoryIds.has(category.id) || remoteCategoryIds.has(category.id)),
        ...catalog.categories.filter(
          (category) => !pendingCategoryIds.has(category.id) && !this.data.categories.some((local) => local.id === category.id),
        ),
      ].map((category) => {
        if (pendingCategoryIds.has(category.id)) return category
        return catalog.categories.find((remote) => remote.id === category.id) ?? category
      })
    })

  /* ----- products ----- */

  getProducts = () => this.read(() => this.data.products.map((p) => this.toRecord(p)))

  getProduct = (id: string) =>
    this.read(() => {
      const p = this.data.products.find((x) => x.id === id)
      if (!p) throw new NotFoundError('This product')
      return this.toRecord(p)
    })

  createProduct = (input: ProductInput) =>
    this.write(() => {
      this.assertValid(validateProduct(input))
      const product: Product = { ...input, id: nextId('p'), updatedAt: this.now() }
      this.data.products = [product, ...this.data.products]
      this.enqueue({
        kind: 'product.create',
        entityType: 'product',
        entityId: product.id,
        entityLabel: product.name,
        summary: 'Product created',
        crdt: 'OR-Set',
        discardable: false,
        retailOperation: { operationId: nextId('retail'), kind: 'product.upsert', product },
      })
      return this.toRecord(product)
    })

  updateProduct = (id: string, input: ProductInput) =>
    this.write(() => {
      this.assertValid(validateProduct(input))
      const current = this.data.products.find((p) => p.id === id)
      if (!current) throw new NotFoundError('This product')
      const label = input.name
      const updatedAt = this.now()
      const next: Product = { ...current, ...input, stock: input.stock, updatedAt }

      if (input.price !== current.price) {
        this.enqueue({
          kind: 'product.update',
          entityType: 'product',
          entityId: id,
          entityLabel: label,
          summary: `Price ${formatDA(current.price)} → ${formatDA(input.price)}`,
          field: 'price',
          from: formatDA(current.price),
          to: formatDA(input.price),
          crdt: 'LWW Register',
          discardable: true,
          retailOperation: {
            operationId: nextId('retail'),
            kind: 'product.patch',
            productId: id,
            changes: { price: input.price },
          },
        })
      }

      const changedDetails = (['name', 'nameAr', 'description', 'descriptionAr', 'categoryId', 'availability', 'lowStockThreshold'] as const).filter(
        (k) => input[k] !== current[k],
      )
      if (changedDetails.length > 0) {
        this.enqueue({
          kind: 'product.update',
          entityType: 'product',
          entityId: id,
          entityLabel: label,
          summary: `Details updated (${changedDetails.map(fieldLabel).join(', ')})`,
          field: 'details',
          crdt: 'LWW Register',
          discardable: false,
          retailOperation: {
            operationId: nextId('retail'),
            kind: 'product.patch',
            productId: id,
            changes: Object.fromEntries(changedDetails.map((field) => [field, input[field]])),
          },
        })
      }

      if (input.stock !== current.stock) this.recordAdjustment(current, input.stock - current.stock, 'correct', 'correction', 'Edited in product form', input.stock)

      this.data.products = this.data.products.map((p) => (p.id === id ? next : p))
      return this.toRecord(next)
    })

  deleteProduct = (id: string) =>
    this.write(() => {
      const current = this.data.products.find((p) => p.id === id)
      if (!current) throw new NotFoundError('This product')
      this.data.products = this.data.products.filter((p) => p.id !== id)
      this.data.tombstones = [...this.data.tombstones, id]
      this.enqueue({
        kind: 'product.delete',
        entityType: 'product',
        entityId: id,
        entityLabel: current.name,
        summary: 'Product deleted',
        crdt: 'OR-Set',
        discardable: false,
        retailOperation: { operationId: nextId('retail'), kind: 'product.delete', productId: id },
      })
      return current
    })

  restoreProduct = (product: Product) =>
    this.write(() => {
      this.data.products = [{ ...product, updatedAt: this.now() }, ...this.data.products]
      this.data.tombstones = this.data.tombstones.filter((t) => t !== product.id)
      const queuedDelete = this.engine
        .getSnapshot()
        .pending.find((p) => p.kind === 'product.delete' && p.entityId === product.id && p.status === 'pending')
      if (queuedDelete) {
        this.engine.removeChange(queuedDelete.id)
      } else {
        this.enqueue({
          kind: 'product.create',
          entityType: 'product',
          entityId: product.id,
          entityLabel: product.name,
          summary: 'Product restored',
          crdt: 'OR-Set',
          discardable: false,
          retailOperation: { operationId: nextId('retail'), kind: 'product.upsert', product },
        })
      }
      return this.toRecord(product)
    })

  /* ----- categories ----- */

  getCategories = () => this.read(() => this.data.categories.map((c) => this.toCategoryRecord(c)))

  createCategory = (input: CategoryInput) =>
    this.write(() => {
      this.assertCategory(input)
      const category: Category = { ...input, id: nextId('c'), updatedAt: this.now() }
      this.data.categories = [...this.data.categories, category]
      this.enqueue({
        kind: 'category.create',
        entityType: 'category',
        entityId: category.id,
        entityLabel: category.name,
        summary: 'Category created',
        crdt: 'OR-Set',
        discardable: false,
        retailOperation: { operationId: nextId('retail'), kind: 'category.upsert', category },
      })
      return this.toCategoryRecord(category)
    })

  updateCategory = (id: string, input: CategoryInput) =>
    this.write(() => {
      this.assertCategory(input)
      const current = this.data.categories.find((c) => c.id === id)
      if (!current) throw new NotFoundError('This category')
      const next: Category = { ...current, ...input, updatedAt: this.now() }
      this.data.categories = this.data.categories.map((c) => (c.id === id ? next : c))
      this.enqueue({
        kind: 'category.update',
        entityType: 'category',
        entityId: id,
        entityLabel: next.name,
        summary: 'Category updated',
        field: 'details',
        crdt: 'LWW Register',
        discardable: false,
        retailOperation: { operationId: nextId('retail'), kind: 'category.upsert', category: next },
      })
      return this.toCategoryRecord(next)
    })

  deleteCategory = (id: string) =>
    this.write(() => {
      const current = this.data.categories.find((c) => c.id === id)
      if (!current) throw new NotFoundError('This category')
      const inUse = this.data.products.filter((p) => p.categoryId === id).length
      if (inUse > 0)
        throw new ValidationError(
          `${current.name} still has ${inUse} ${inUse === 1 ? 'product' : 'products'}. Move or delete them first.`,
        )
      this.data.categories = this.data.categories.filter((c) => c.id !== id)
      this.enqueue({
        kind: 'category.delete',
        entityType: 'category',
        entityId: id,
        entityLabel: current.name,
        summary: 'Category deleted',
        crdt: 'OR-Set',
        discardable: false,
        retailOperation: { operationId: nextId('retail'), kind: 'category.delete', categoryId: id },
      })
    })

  /* ----- stock ----- */

  getStock = () =>
    this.read<StockRow[]>(() =>
      this.data.products.map((p) => ({
        product: this.toRecord(p),
        lastAdjustment: this.data.adjustments.find((a) => a.productId === p.id) ?? null,
      })),
    )

  getStockHistory = (productId?: string) =>
    this.read(() => this.data.adjustments.filter((a) => !productId || a.productId === productId))

  adjustStock = (input: StockAdjustmentInput) =>
    this.write(() => {
      const errors = validateAdjustment(input)
      this.assertValid(errors)
      const product = this.data.products.find((p) => p.id === input.productId)
      if (!product) throw new NotFoundError('This product')
      const delta = adjustmentDelta(input.type, input.quantity, product.stock)
      const adjustment = this.recordAdjustment(product, delta, input.type, input.reason, input.notes, product.stock + delta)
      this.data.products = this.data.products.map((p) =>
        p.id === product.id ? { ...p, stock: p.stock + delta, updatedAt: this.now() } : p,
      )
      return adjustment
    })

  /* ----- synchronization & devices ----- */

  getSyncState = () => this.read<SyncSnapshot>(() => this.engine.getSnapshot())

  getReplicaStats = () => this.read<ReplicaStats>(() => this.stats())

  getDevices = () => this.read(() => this.devices())

  getDevice = (id: string) =>
    this.read(() => {
      const d = this.devices().find((x) => x.id === id)
      if (!d) throw new NotFoundError('This device')
      return d
    })

  discardPendingChange = (id: string) =>
    this.write(() => {
      const op = this.engine.getSnapshot().pending.find((p) => p.id === id)
      if (!op || !op.discardable) throw new RepositoryError('This change cannot be removed without reverting it.')
      if (op.field === 'price' && op.from) {
        const previous = Number(op.from.replace(/\D/g, ''))
        this.data.products = this.data.products.map((p) =>
          p.id === op.entityId ? { ...p, price: previous, updatedAt: this.now() } : p,
        )
      }
      this.engine.removeChange(id)
    })

  /* ----- internals ----- */

  private async read<T>(fn: () => T): Promise<T> {
    await this.delay()
    if (this.failReads) {
      logger.warn('REPOSITORY', 'Simulated read failure')
      throw new RepositoryError('The local replica could not be read.')
    }
    return fn()
  }

  private async write<T>(fn: () => T): Promise<T> {
    await this.delay(Math.min(this.latencyMs, 250))
    const result = fn()
    this.commit()
    return result
  }

  private delay(ms = this.latencyMs): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
  }

  private commit(): void {
    writeJson(this.storage, DATA_KEY, this.data)
    this.emit()
  }

  private emit(): void {
    this.listeners.forEach((l) => l())
  }

  private enqueue(draft: ChangeDraft): void {
    this.engine.enqueue(draft)
  }

  private applyVersionedOperation(operation: VersionedRetailOperation, source: 'local' | 'remote'): void {
    const metadata = this.data.versioned!
    if (metadata.applied.includes(operation.operationId)) return
    metadata.applied.push(operation.operationId)
    if (source === 'local') {
      if (operation.kind === 'product.restore') {
        metadata.productRestores[operation.productId] = operation.version
        metadata.productFields[operation.productId] = Object.fromEntries(
          Object.keys(operation.product).map((field) => [field, operation.version]),
        )
      }
      if (operation.kind === 'product.delete') metadata.productTombstones[operation.productId] = operation.version
      if (operation.kind === 'product.patch') {
        const versions = metadata.productFields[operation.productId] ?? {}
        for (const field of Object.keys(operation.changes)) versions[field] = operation.version
        metadata.productFields[operation.productId] = versions
      }
      if (operation.kind === 'category.patch') {
        const versions = metadata.categoryFields[operation.categoryId] ?? {}
        for (const field of Object.keys(operation.changes)) versions[field] = operation.version
        metadata.categoryFields[operation.categoryId] = versions
      }
      if (operation.kind === 'category.delete') metadata.categoryTombstones[operation.categoryId] = operation.version
      this.commit()
      return
    }
    if (operation.kind === 'product.restore') {
      const currentRestore = metadata.productRestores[operation.productId]
      const currentVersion = metadata.productTombstones[operation.productId]
      if ((!currentRestore || compareRetailVersions(operation.version, currentRestore) > 0) &&
          (!currentVersion || compareRetailVersions(operation.version, currentVersion) > 0)) {
        this.data.products = [
          operation.product,
          ...this.data.products.filter((product) => product.id !== operation.productId),
        ]
        this.data.tombstones = this.data.tombstones.filter((id) => id !== operation.productId)
        metadata.productRestores[operation.productId] = operation.version
      }
    } else if (operation.kind === 'product.delete') {
      const currentVersion = metadata.productTombstones[operation.productId]
      const restoreVersion = metadata.productRestores[operation.productId]
      if ((!currentVersion || compareRetailVersions(operation.version, currentVersion) > 0) &&
          (!restoreVersion || compareRetailVersions(operation.version, restoreVersion) > 0)) {
        metadata.productTombstones[operation.productId] = operation.version
        this.data.products = this.data.products.filter((product) => product.id !== operation.productId)
        if (!this.data.tombstones.includes(operation.productId)) this.data.tombstones.push(operation.productId)
      }
    } else if (operation.kind === 'product.patch') {
      const product = this.data.products.find((item) => item.id === operation.productId)
      if (product && !metadata.productTombstones[operation.productId]) {
        const versions = metadata.productFields[operation.productId] ?? {}
        for (const [field, value] of Object.entries(operation.changes)) {
          const restoreVersion = metadata.productRestores[operation.productId]
          if ((!restoreVersion || compareRetailVersions(operation.version, restoreVersion) > 0) &&
              (!versions[field] || compareRetailVersions(operation.version, versions[field]) > 0)) {
            ;(product as unknown as Record<string, unknown>)[field] = value
            versions[field] = operation.version
          }
        }
        metadata.productFields[operation.productId] = versions
      }
    } else if (operation.kind === 'category.patch') {
      const category = this.data.categories.find((item) => item.id === operation.categoryId)
      if (!category && typeof operation.changes.name === 'string') {
        this.data.categories.push({
          id: operation.categoryId,
          name: operation.changes.name,
          nameAr: operation.changes.nameAr ?? '',
          description: operation.changes.description ?? '',
          updatedAt: operation.version.logicalTime,
        })
      } else if (category && (!metadata.categoryTombstones[operation.categoryId] || compareRetailVersions(operation.version, metadata.categoryTombstones[operation.categoryId]) > 0)) {
        const versions = metadata.categoryFields[operation.categoryId] ?? {}
        for (const [field, value] of Object.entries(operation.changes)) {
          if (!versions[field] || compareRetailVersions(operation.version, versions[field]) > 0) {
            ;(category as unknown as Record<string, unknown>)[field] = value
            versions[field] = operation.version
          }
        }
        metadata.categoryFields[operation.categoryId] = versions
      }
    } else if (operation.kind === 'category.delete') {
      const currentVersion = metadata.categoryTombstones[operation.categoryId]
      if (!currentVersion || compareRetailVersions(operation.version, currentVersion) > 0) {
        metadata.categoryTombstones[operation.categoryId] = operation.version
        this.data.categories = this.data.categories.filter((category) => category.id !== operation.categoryId)
      }
    } else {
      const product = this.data.products.find((item) => item.id === operation.productId)
      if (product) product.stock = Math.max(0, product.stock + operation.delta)
    }
    this.commit()
  }

  private applyRemote(change: RemoteChange): void {
    this.data.products = this.data.products.map((p) =>
      p.id === change.entityId ? { ...p, price: change.value, updatedAt: this.now() } : p,
    )
    this.commit()
  }

  private recordAdjustment(
    product: Product,
    delta: number,
    type: StockAdjustment['type'],
    reason: StockAdjustment['reason'],
    notes: string,
    resultingStock: number,
  ): StockAdjustment {
    const adjustment: StockAdjustment = {
      id: nextId('adj'),
      productId: product.id,
      type,
      delta,
      reason,
      notes,
      resultingStock,
      createdAt: this.now(),
      deviceId: THIS_DEVICE_ID,
    }
    this.data.adjustments = [adjustment, ...this.data.adjustments]
    this.enqueue({
      kind: 'stock.adjust',
      entityType: 'stock',
      entityId: product.id,
      entityLabel: product.name,
      summary: `Stock ${delta >= 0 ? '+' : '−'}${Math.abs(delta)} (${reason})`,
      field: 'stock',
      crdt: 'PN-Counter',
      discardable: false,
      retailOperation: { operationId: nextId('retail'), kind: 'inventory.adjust', productId: product.id, delta },
    })
    return adjustment
  }

  private entitySyncState(entityId: string): EntitySyncState {
    const ops = this.engine.getSnapshot().pending.filter((p) => p.entityId === entityId)
    if (ops.length === 0) return 'synced'
    return ops.some((o) => o.status === 'failed') ? 'failed' : 'pending'
  }

  private toRecord(p: Product): ProductRecord {
    return {
      ...p,
      categoryName: this.data.categories.find((c) => c.id === p.categoryId)?.name ?? 'Uncategorised',
      stockLevel: stockLevel(p.stock, p.lowStockThreshold),
      syncState: this.entitySyncState(p.id),
    }
  }

  private toCategoryRecord(c: Category): CategoryRecord {
    return {
      ...c,
      productCount: this.data.products.filter((p) => p.categoryId === c.id).length,
      syncState: this.entitySyncState(c.id),
    }
  }

  private stats(): ReplicaStats {
    const tombstones = this.data.tombstones.length
    return {
      stateSizeBytes: JSON.stringify(this.data).length,
      metadataBytes: 12_000 + 64 * (this.data.products.length + this.data.categories.length) + 48 * tombstones,
      tombstones,
    }
  }

  private devices(): Device[] {
    const snap = this.engine.getSnapshot()
    const now = this.now()
    const stats = this.stats()
    const self: Device = {
      id: THIS_DEVICE_ID,
      name: 'Counter tablet',
      role: 'Primary POS',
      replicaId: this.engine.replicaId,
      status:
        snap.connectivity === 'offline'
          ? 'offline'
          : snap.connectivity === 'connecting'
            ? 'unknown'
            : snap.phase === 'syncing'
              ? 'syncing'
              : 'online',
      lastSeenAt: snap.connectivity === 'online' ? now : (snap.activity.find((a) => a.kind === 'connection-lost')?.at ?? snap.lastSyncAt),
      lastSyncAt: snap.lastSyncAt,
      pendingChanges: snap.pending.length,
      isThisDevice: true,
      stateSizeBytes: stats.stateSizeBytes,
      metadataBytes: stats.metadataBytes,
      platform: 'This browser',
    }
    const peers: Device[] = PEER_SEEDS.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      replicaId: s.replicaId,
      status: s.status === 'online' && snap.connectivity !== 'online' ? 'unknown' : s.status,
      lastSeenAt: s.lastSeenAgoMs === null ? null : now - s.lastSeenAgoMs,
      lastSyncAt: s.lastSyncAgoMs === null ? null : now - s.lastSyncAgoMs,
      pendingChanges: s.pendingChanges,
      isThisDevice: false,
      stateSizeBytes: s.stateSizeBytes,
      metadataBytes: s.metadataBytes,
      platform: s.platform,
    }))
    return [self, ...peers]
  }

  private assertValid(errors: Record<string, string | undefined>): void {
    const entries = Object.entries(errors).filter((e): e is [string, string] => Boolean(e[1]))
    if (entries.length > 0) throw new ValidationError('Some fields need attention.', Object.fromEntries(entries))
  }

  private assertCategory(input: CategoryInput): void {
    const error = validateCategoryName(input.name)
    if (error) throw new ValidationError(error, { name: error })
  }
}

function fieldLabel(key: string): string {
  const map: Record<string, string> = {
    name: 'name',
    nameAr: 'Arabic name',
    description: 'description',
    descriptionAr: 'Arabic description',
    categoryId: 'category',
    availability: 'availability',
    lowStockThreshold: 'threshold',
  }
  return map[key] ?? key
}
