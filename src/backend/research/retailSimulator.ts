import type { Category, Product } from '../../domain/types'

export type RetailReplicaId = 'A' | 'B' | 'C'
export type RetailField = 'name' | 'price' | 'availability' | 'categoryId'
export type CategoryField = 'name' | 'nameAr' | 'description'

export interface RetailVersion {
  logicalTime: number
  replicaId: RetailReplicaId
  operationId: string
}

export type RetailSimulationModel = 'baseline' | 'candidate'

export type RetailSimulationOperation =
  | {
      operationId: string
      origin: RetailReplicaId
      kind: 'product.field.update'
      productId: string
      field: RetailField
      value: Product[RetailField]
      version?: RetailVersion
    }
  | {
      operationId: string
      origin: RetailReplicaId
      kind: 'product.delete'
      productId: string
      version?: RetailVersion
    }
  | {
      operationId: string
      origin: RetailReplicaId
      kind: 'product.restore'
      product: Product
      version?: RetailVersion
    }
  | {
      operationId: string
      origin: RetailReplicaId
      kind: 'inventory.adjust'
      productId: string
      delta: number
      version?: RetailVersion
    }
  | {
      operationId: string
      origin: RetailReplicaId
      kind: 'category.update'
      category: Category
      version?: RetailVersion
    }
  | {
      operationId: string
      origin: RetailReplicaId
      kind: 'category.field.update'
      categoryId: string
      field: CategoryField
      value: Category[CategoryField]
      version?: RetailVersion
    }

export interface RetailSimulationState {
  products: Product[]
  categories: Category[]
  appliedOperationIds: string[]
  inventoryDeltas: Record<string, number>
}

export interface RetailSimulationMetrics {
  generatedOperations: number
  deliveries: number
  duplicateDeliveries: number
  uniqueOperationsApplied: number
  bytesTransferred: number
  finalStateBytes: Record<RetailReplicaId, number>
  finalMetadataCounts: Record<RetailReplicaId, number>
  converged: boolean
}

export interface RetailSimulationReport {
  replicaIds: RetailReplicaId[]
  events: RetailSimulationEvent[]
  states: Record<RetailReplicaId, RetailSimulationState>
  metrics: RetailSimulationMetrics
}

export interface RetailSimulationEvent {
  type: 'local' | 'queued' | 'delivered' | 'duplicate' | 'dropped' | 'partition' | 'reconnect'
  operationId?: string
  from?: RetailReplicaId
  target?: RetailReplicaId
  detail?: string
}

interface QueuedOperation {
  sequence: number
  from: RetailReplicaId
  target: RetailReplicaId
  operation: RetailSimulationOperation
  deliverAt: number
}

const REPLICAS: RetailReplicaId[] = ['A', 'B', 'C']

const clone = <T>(value: T): T => structuredClone(value)

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

const serializedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

interface CandidateProductRecord {
  fields: Product
  fieldVersions: Partial<Record<keyof Product, RetailVersion>>
  tombstone?: RetailVersion
  restoredVersion?: RetailVersion
}

interface CandidateCategoryRecord {
  fields: Category
  fieldVersions: Partial<Record<keyof Category, RetailVersion>>
}

const compareVersions = (left: RetailVersion, right: RetailVersion): number =>
  left.logicalTime - right.logicalTime ||
  left.replicaId.localeCompare(right.replicaId) ||
  left.operationId.localeCompare(right.operationId)

export class RetailReplicaSimulator {
  private readonly states = new Map<RetailReplicaId, RetailSimulationState>()
  private readonly initialProducts = new Map<string, Product>()
  private readonly pendingDeliveries: QueuedOperation[] = []
  private readonly partitions = new Set<RetailReplicaId>()
  private readonly events: RetailSimulationEvent[] = []
  private readonly generated = new Set<string>()
  private readonly model: RetailSimulationModel
  private readonly candidateProducts = new Map<RetailReplicaId, Map<string, CandidateProductRecord>>()
  private readonly candidateCategories = new Map<RetailReplicaId, Map<string, CandidateCategoryRecord>>()
  private sequence = 0
  private virtualTime = 0

  constructor(
    initial: { products?: Product[]; categories?: Category[] } = {},
    model: RetailSimulationModel = 'baseline',
  ) {
    this.model = model
    for (const replicaId of REPLICAS) {
      this.states.set(replicaId, {
        products: clone(initial.products ?? []),
        categories: clone(initial.categories ?? []),
        appliedOperationIds: [],
        inventoryDeltas: {},
      })
      if (model === 'candidate') {
        this.candidateProducts.set(
          replicaId,
          new Map((initial.products ?? []).map((product) => [
            product.id,
            {
              fields: clone(product),
              fieldVersions: {},
            },
          ])),
        )
        this.candidateCategories.set(
          replicaId,
          new Map((initial.categories ?? []).map((category) => [
            category.id,
            {
              fields: clone(category),
              fieldVersions: {},
            },
          ])),
        )
      }
    }
    for (const product of initial.products ?? []) this.initialProducts.set(product.id, clone(product))
  }

  local(replicaId: RetailReplicaId, operation: RetailSimulationOperation): void {
    this.requireReplica(replicaId)
    if (operation.origin !== replicaId) throw new Error('Operation origin must match local replica')
    if (this.generated.has(operation.operationId)) throw new Error(`Duplicate generated operation ${operation.operationId}`)
    this.generated.add(operation.operationId)
    this.operations.set(operation.operationId, clone(operation))
    this.apply(replicaId, operation)
    this.events.push({ type: 'local', from: replicaId, operationId: operation.operationId })
  }

  partition(replicaId: RetailReplicaId): void {
    this.requireReplica(replicaId)
    this.partitions.add(replicaId)
    this.events.push({ type: 'partition', target: replicaId })
  }

  reconnect(replicaId: RetailReplicaId): void {
    this.requireReplica(replicaId)
    this.partitions.delete(replicaId)
    this.events.push({ type: 'reconnect', target: replicaId })
  }

  queue(operationId: string, from: RetailReplicaId, target: RetailReplicaId, options: { duplicate?: boolean; delay?: number } = {}): void {
    this.requireReplica(from)
    this.requireReplica(target)
    const operation = this.findGenerated(operationId)
    const queued: QueuedOperation = {
      sequence: ++this.sequence,
      from,
      target,
      operation,
      deliverAt: this.virtualTime + (options.delay ?? 0),
    }
    this.pendingDeliveries.push(queued)
    this.events.push({
      type: 'queued',
      from,
      target,
      operationId,
      detail: this.partitions.has(from) || this.partitions.has(target) ? 'partitioned' : undefined,
    })
    if (options.duplicate) {
      this.pendingDeliveries.push({ ...queued, sequence: ++this.sequence })
      this.events.push({ type: 'duplicate', from, target, operationId })
    }
  }

  reconnectAndDeliverAll(): void {
    for (const replicaId of REPLICAS) this.reconnect(replicaId)
    this.deliverAll()
  }

  deliverNext(): boolean {
    if (this.pendingDeliveries.length === 0) return false
    this.pendingDeliveries.sort((a, b) => a.deliverAt - b.deliverAt || a.sequence - b.sequence)
    const queued = this.pendingDeliveries.shift()!
    this.virtualTime = Math.max(this.virtualTime, queued.deliverAt)
    const state = this.requireReplica(queued.target)
    const before = state.appliedOperationIds.length
    this.apply(queued.target, queued.operation)
    this.events.push({
      type: before === state.appliedOperationIds.length ? 'duplicate' : 'delivered',
      from: queued.from,
      target: queued.target,
      operationId: queued.operation.operationId,
      detail: before === state.appliedOperationIds.length ? 'already-applied' : undefined,
    })
    return true
  }

  deliverAll(): void {
    while (this.deliverNext()) {}
  }

  state(replicaId: RetailReplicaId): RetailSimulationState {
    return clone(this.requireReplica(replicaId))
  }

  report(): RetailSimulationReport {
    const states = Object.fromEntries(REPLICAS.map((id) => [id, this.state(id)])) as Record<RetailReplicaId, RetailSimulationState>
    const canonicalStates = REPLICAS.map((id) =>
      JSON.stringify(canonicalize({
        products: states[id].products,
        categories: states[id].categories,
        inventoryDeltas: states[id].inventoryDeltas,
      })),
    )
    const finalStateBytes = Object.fromEntries(REPLICAS.map((id) => [id, serializedBytes(states[id])])) as Record<RetailReplicaId, number>
    const finalMetadataCounts = Object.fromEntries(REPLICAS.map((id) => [id, states[id].appliedOperationIds.length])) as Record<RetailReplicaId, number>
    const deliveries = this.events.filter((event) => event.type === 'delivered' || event.type === 'duplicate').length
    const duplicateDeliveries = this.events.filter((event) => event.type === 'duplicate' && event.detail === 'already-applied').length
    return {
      replicaIds: [...REPLICAS],
      events: this.events.map((event) => ({ ...event })),
      states,
      metrics: {
        generatedOperations: this.generated.size,
        deliveries,
        duplicateDeliveries,
        uniqueOperationsApplied: new Set(REPLICAS.flatMap((id) => states[id].appliedOperationIds)).size,
        bytesTransferred: this.events
          .filter((event) => event.type === 'queued' || (event.type === 'duplicate' && !event.detail))
          .reduce((total, event) => total + serializedBytes(this.findGenerated(event.operationId!)), 0),
        finalStateBytes,
        finalMetadataCounts,
        converged: canonicalStates.every((state) => state === canonicalStates[0]),
      },
    }
  }

  private apply(replicaId: RetailReplicaId, operation: RetailSimulationOperation): void {
    const state = this.requireReplica(replicaId)
    if (state.appliedOperationIds.includes(operation.operationId)) return
    state.appliedOperationIds.push(operation.operationId)
    if (this.model === 'candidate') {
      this.applyCandidate(replicaId, operation)
      return
    }
    if (operation.kind === 'product.field.update') {
      const existing = state.products.find((product) => product.id === operation.productId)
      const base = existing ?? this.initialProducts.get(operation.productId)
      if (base) {
        state.products = [
          { ...base, ...(existing ?? {}), [operation.field]: operation.value },
          ...state.products.filter((product) => product.id !== operation.productId),
        ]
      }
    } else if (operation.kind === 'product.delete') {
      state.products = state.products.filter((product) => product.id !== operation.productId)
    } else if (operation.kind === 'product.restore') {
      state.products = [operation.product, ...state.products.filter((product) => product.id !== operation.product.id)]
    } else if (operation.kind === 'inventory.adjust') {
      state.inventoryDeltas[operation.productId] = (state.inventoryDeltas[operation.productId] ?? 0) + operation.delta
    } else if (operation.kind === 'category.update') {
      state.categories = [operation.category, ...state.categories.filter((category) => category.id !== operation.category.id)]
    }
  }

  private applyCandidate(replicaId: RetailReplicaId, operation: RetailSimulationOperation): void {
    const version = operation.version
    if (!version || version.operationId !== operation.operationId || version.replicaId !== operation.origin)
      throw new Error(`Candidate operation ${operation.operationId} requires matching version metadata`)

    const state = this.requireReplica(replicaId)
    const products = this.candidateProducts.get(replicaId)!
    const categories = this.candidateCategories.get(replicaId)!

    if (operation.kind === 'product.field.update') {
      const record = products.get(operation.productId)
      if (!record || record.tombstone) return
      const previous = record.fieldVersions[operation.field]
      if (!previous || compareVersions(version, previous) > 0) {
        record.fields = { ...record.fields, [operation.field]: operation.value }
        record.fieldVersions[operation.field] = version
      }
    } else if (operation.kind === 'product.delete') {
      const record = products.get(operation.productId)
      if (
        record &&
        (!record.restoredVersion || compareVersions(version, record.restoredVersion) > 0) &&
        (!record.tombstone || compareVersions(version, record.tombstone) > 0)
      )
        record.tombstone = version
    } else if (operation.kind === 'product.restore') {
      const existing = products.get(operation.product.id)
      if (!existing || !existing.tombstone || compareVersions(version, existing.tombstone) > 0) {
        products.set(operation.product.id, {
          fields: clone(operation.product),
          fieldVersions: {},
          tombstone: undefined,
          restoredVersion: version,
        })
      }
    } else if (operation.kind === 'inventory.adjust') {
      const current = state.inventoryDeltas[operation.productId] ?? 0
      state.inventoryDeltas[operation.productId] = current + operation.delta
    } else if (operation.kind === 'category.update') {
      const record = categories.get(operation.category.id) ?? { fields: clone(operation.category), fieldVersions: {} }
      for (const field of ['name', 'nameAr', 'description'] as const) {
        const previous = record.fieldVersions[field]
        if (!previous || compareVersions(version, previous) > 0) {
          record.fields = { ...record.fields, [field]: operation.category[field] }
          record.fieldVersions[field] = version
        }
      }
      categories.set(operation.category.id, record)
    } else if (operation.kind === 'category.field.update') {
      const record = categories.get(operation.categoryId)
      if (!record) return
      const previous = record.fieldVersions[operation.field]
      if (!previous || compareVersions(version, previous) > 0) {
        record.fields = { ...record.fields, [operation.field]: operation.value }
        record.fieldVersions[operation.field] = version
      }
    }

    state.products = [...products.values()].filter((record) => !record.tombstone).map((record) => clone(record.fields))
    state.categories = [...categories.values()].map((record) => clone(record.fields))
  }

  private findGenerated(operationId: string): RetailSimulationOperation {
    const operation = this.operations.get(operationId)
    if (!operation) throw new Error(`Unknown generated operation ${operationId}`)
    return operation
  }

  private readonly operations = new Map<string, RetailSimulationOperation>()

  private requireReplica(replicaId: RetailReplicaId): RetailSimulationState {
    const state = this.states.get(replicaId)
    if (!state) throw new Error(`Unknown replica ${replicaId}`)
    return state
  }
}
