import { ReplicaRuntime } from '@/backend/crdt/replica'
import { createStateMessage, encodeSyncMessage, type StateSyncMessage } from '@/backend/sync/protocol'
import type { PendingChange } from '@/domain/sync'
import type { RetailCatalog, RetailOperation, RetailOperationResult, VersionedRetailOperation } from '@/domain/retailSync'

export interface BackendHealth {
  status: 'ok'
  apiVersion: string
}

export interface BackendReplicaResponse {
  replicaId: string
  snapshot: unknown
  persisted: boolean
  updatedAt: number | null
}

export interface BackendSyncResponse {
  applied: boolean
  acknowledgement: {
    status: 'applied' | 'duplicate'
    messageId: string
  }
  replicaId: string
  snapshot: unknown
  persistedAt: number
}

export interface BackendRetailResponse {
  results: RetailOperationResult[]
  catalog: RetailCatalog
  persistedAt: number
}

export interface SyncOperationResult {
  operationId: string
  status: 'accepted' | 'duplicate'
  position: number
}

export interface SyncOperationPage {
  operations: Array<{ position: number; operation: VersionedRetailOperation }>
  nextCursor: number
  hasMore: boolean
  logSizeBytes: number
}

export class BackendApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

const isProduct = (value: unknown): value is RetailCatalog['products'][number] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const product = value as Record<string, unknown>
  return (
    typeof product.id === 'string' &&
    typeof product.name === 'string' &&
    typeof product.nameAr === 'string' &&
    typeof product.description === 'string' &&
    typeof product.descriptionAr === 'string' &&
    typeof product.price === 'number' &&
    typeof product.categoryId === 'string' &&
    (product.availability === 'available' || product.availability === 'unavailable') &&
    Number.isInteger(product.stock) &&
    Number.isInteger(product.lowStockThreshold) &&
    typeof product.updatedAt === 'number'
  )
}

const isCategory = (value: unknown): value is RetailCatalog['categories'][number] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const category = value as Record<string, unknown>
  return (
    typeof category.id === 'string' &&
    typeof category.name === 'string' &&
    typeof category.nameAr === 'string' &&
    typeof category.description === 'string' &&
    typeof category.updatedAt === 'number'
  )
}

const validateCatalog = (value: unknown): RetailCatalog => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackendApiError(200, 'invalid_backend_response', 'The backend returned an invalid catalog.')
  }
  const catalog = value as { products?: unknown; categories?: unknown }
  if (!Array.isArray(catalog.products) || !catalog.products.every(isProduct) || !Array.isArray(catalog.categories) || !catalog.categories.every(isCategory)) {
    throw new BackendApiError(200, 'invalid_backend_response', 'The backend returned an invalid catalog.')
  }
  return { products: catalog.products, categories: catalog.categories }
}

export class BackendApiClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    if (!baseUrl.trim()) throw new Error('Backend URL is required')
    this.baseUrl = normalizeBaseUrl(baseUrl.trim())
  }

  async health(): Promise<BackendHealth> {
    return this.request<BackendHealth>('/health')
  }

  async getReplica(): Promise<BackendReplicaResponse> {
    return this.request<BackendReplicaResponse>('/v1/replica')
  }

  async syncChanges(
    replicaId: string,
    changes: readonly PendingChange[],
  ): Promise<BackendSyncResponse> {
    const retailOperations = changes.flatMap((change) => change.retailOperation ? [change.retailOperation] : [])
    if (retailOperations.length > 0) await this.syncRetailOperations(retailOperations)
    const replica = new ReplicaRuntime<string>(replicaId)
    for (const change of changes) {
      replica.add(`${change.kind}:${change.entityId}:${change.id}`)
      replica.incrementCounter()
    }

    const messageId = `${replicaId}:${changes.map((change) => change.id).join(',')}`
    const message = createStateMessage(replicaId, messageId, replica.snapshot())
    return this.request<BackendSyncResponse>('/v1/sync/messages', {
      method: 'POST',
      body: JSON.stringify(message),
      headers: { 'content-type': 'application/json' },
    })
  }

  async getRetailCatalog(): Promise<RetailCatalog> {
    const response = await this.request<{ catalog: RetailCatalog }>('/v1/retail/catalog')
    return validateCatalog(response.catalog)
  }

  async syncRetailOperations(operations: readonly RetailOperation[]): Promise<BackendRetailResponse> {
    return this.request<BackendRetailResponse>('/v1/retail/operations', {
      method: 'POST',
      body: JSON.stringify({ operations }),
      headers: { 'content-type': 'application/json' },
    })
  }

  async pushVersionedOperations(operations: readonly VersionedRetailOperation[]): Promise<SyncOperationResult[]> {
    const response = await this.request<{ results: SyncOperationResult[] }>('/v1/sync/operations', {
      method: 'POST',
      body: JSON.stringify({ operations }),
      headers: { 'content-type': 'application/json' },
    })
    return response.results
  }

  async pullVersionedOperations(after = 0, limit = 100): Promise<SyncOperationPage> {
    return this.request<SyncOperationPage>(`/v1/sync/operations?after=${after}&limit=${limit}`)
  }

  encodeChanges(replicaId: string, changes: readonly PendingChange[]): Uint8Array {
    const replica = new ReplicaRuntime<string>(replicaId)
    for (const change of changes) replica.add(`${change.kind}:${change.entityId}:${change.id}`)
    const message: StateSyncMessage<string> = createStateMessage(
      replicaId,
      `${replicaId}:${changes.map((change) => change.id).join(',')}`,
      replica.snapshot(),
    )
    return encodeSyncMessage(message)
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, options)
    } catch {
      throw new BackendApiError(0, 'backend_unavailable', 'The backend is unavailable.')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new BackendApiError(response.status, 'invalid_backend_response', 'The backend returned an invalid response.')
    }

    if (!response.ok) {
      const error = body as { error?: { code?: string; message?: string } }
      throw new BackendApiError(
        response.status,
        error.error?.code ?? 'backend_error',
        error.error?.message ?? 'The backend request failed.',
      )
    }

    return body as T
  }
}
