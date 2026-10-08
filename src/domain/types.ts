export type Availability = 'available' | 'unavailable'
export type StockLevel = 'ok' | 'low' | 'out' | 'negative'
export type EntitySyncState = 'synced' | 'pending' | 'failed'

export interface Product {
  id: string
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  price: number
  categoryId: string
  availability: Availability
  stock: number
  lowStockThreshold: number
  updatedAt: number
}

export type ProductInput = Omit<Product, 'id' | 'updatedAt'>

export interface ProductRecord extends Product {
  categoryName: string
  stockLevel: StockLevel
  syncState: EntitySyncState
}

export interface Category {
  id: string
  name: string
  nameAr: string
  description: string
  updatedAt: number
}

export type CategoryInput = Omit<Category, 'id' | 'updatedAt'>

export interface CategoryRecord extends Category {
  productCount: number
  syncState: EntitySyncState
}

export type AdjustmentType = 'add' | 'remove' | 'correct'
export type AdjustmentReason = 'restock' | 'sale' | 'waste' | 'correction'

export interface StockAdjustment {
  id: string
  productId: string
  type: AdjustmentType
  /** Signed delta applied to the stock counter. */
  delta: number
  reason: AdjustmentReason
  notes: string
  resultingStock: number
  createdAt: number
  deviceId: string
}

export interface StockAdjustmentInput {
  productId: string
  type: AdjustmentType
  quantity: number
  reason: AdjustmentReason
  notes: string
}

export interface StockRow {
  product: ProductRecord
  lastAdjustment: StockAdjustment | null
}

export type Role = 'owner' | 'manager' | 'staff'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  workspaceName: string
}

export type DeviceStatus = 'online' | 'offline' | 'syncing' | 'unknown' | 'evicted'
export type DeviceRole = 'Primary POS' | 'Kitchen display' | 'Manager mobile' | 'Back office' | 'Stock scanner'

export interface Device {
  id: string
  name: string
  role: DeviceRole
  replicaId: string
  status: DeviceStatus
  lastSeenAt: number | null
  lastSyncAt: number | null
  pendingChanges: number
  isThisDevice: boolean
  stateSizeBytes: number
  metadataBytes: number
  platform: string
}

export class ValidationError extends Error {
  readonly fieldErrors: Record<string, string>
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ValidationError'
    this.fieldErrors = fieldErrors
  }
}

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepositoryError'
  }
}
