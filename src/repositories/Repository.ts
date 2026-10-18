import type {
  CategoryInput,
  CategoryRecord,
  Device,
  Product,
  ProductInput,
  ProductRecord,
  StockAdjustment,
  StockAdjustmentInput,
  StockRow,
} from '@/domain/types'
import type { SyncSnapshot } from '@/domain/sync'
import type { RetailCatalog } from '@/domain/retailSync'

export interface ReplicaStats {
  /** Serialized size of the local data set, measured. */
  stateSizeBytes: number
  /** Estimated CRDT metadata overhead. Simulation metric. */
  metadataBytes: number
  tombstones: number
}

/**
 * Everything the UI may know about persistence and replication.
 * Implementations: MockRepository (in-memory + localStorage) today,
 * a CRDT-backed replica later.
 */
export interface Repository {
  subscribe(listener: () => void): () => void

  getProducts(): Promise<ProductRecord[]>
  getProduct(id: string): Promise<ProductRecord>
  createProduct(input: ProductInput): Promise<ProductRecord>
  updateProduct(id: string, input: ProductInput): Promise<ProductRecord>
  deleteProduct(id: string): Promise<Product>
  restoreProduct(product: Product): Promise<ProductRecord>

  getCategories(): Promise<CategoryRecord[]>
  createCategory(input: CategoryInput): Promise<CategoryRecord>
  updateCategory(id: string, input: CategoryInput): Promise<CategoryRecord>
  deleteCategory(id: string): Promise<void>

  getStock(): Promise<StockRow[]>
  getStockHistory(productId?: string): Promise<StockAdjustment[]>
  adjustStock(input: StockAdjustmentInput): Promise<StockAdjustment>

  getSyncState(): Promise<SyncSnapshot>
  getDevices(): Promise<Device[]>
  getDevice(id: string): Promise<Device>
  getReplicaStats(): Promise<ReplicaStats>

  discardPendingChange(id: string): Promise<void>
  hydrateCatalog(catalog: RetailCatalog): Promise<void>
}
