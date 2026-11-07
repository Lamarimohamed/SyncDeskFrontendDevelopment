import { compareRetailVersions, type RetailVersion } from './retailSync'

export type StockOperation =
  | {
      schemaVersion?: 2
      operationId: string
      productId: string
      replicaId: string
      version: RetailVersion
      kind: 'inventory.restock'
      tokenIds: string[]
    }
  | {
      schemaVersion?: 2
      operationId: string
      productId: string
      replicaId: string
      version: RetailVersion
      kind: 'inventory.decrement'
      tokenIds: string[]
    }
  | {
      schemaVersion?: 2
      operationId: string
      productId: string
      replicaId: string
      version: RetailVersion
      kind: 'inventory.transfer'
      transferId: string
      fromReplicaId: string
      toReplicaId: string
      tokenIds: string[]
    }

export interface StockToken {
  owner: string
  consumedBy?: string
}

export interface EscrowedStockState {
  initialTokens: Record<string, string>
  operations: StockOperation[]
  retiredReplicaIds: string[]
  allocations?: Record<string, string>
}

export interface StockSnapshot {
  value: number
  availableRights: Record<string, number>
  tokens: Record<string, StockToken>
  appliedOperationIds: string[]
  incrementComponents: Record<string, number>
  decrementComponents: Record<string, number>
}

export type StockOperationOutcomeStatus = 'applied' | 'rejected' | 'no-effect' | 'duplicate' | 'conflict'

export interface StockOperationOutcome {
  operationId: string
  status: StockOperationOutcomeStatus
  reason?: string
}

export const initialStockState = (
  stock: number,
  owner: string,
  prefix: string,
): EscrowedStockState => ({
  initialTokens: Object.fromEntries(
    Array.from({ length: stock }, (_, index) => [`${prefix}:initial:${index}`, owner]),
  ),
  operations: [],
  retiredReplicaIds: [],
  allocations: {},
})

const cloneState = (state: EscrowedStockState): EscrowedStockState => structuredClone(state)

const uniqueTokenIds = (tokenIds: readonly string[]): boolean =>
  tokenIds.length > 0 &&
  tokenIds.every((tokenId) => typeof tokenId === 'string' && tokenId.length > 0) &&
  new Set(tokenIds).size === tokenIds.length

export class EscrowedStock {
  private state: EscrowedStockState
  private operations = new Map<string, StockOperation>()
  private snapshotValue: StockSnapshot

  constructor(
    private readonly replicaId: string,
    state: EscrowedStockState,
  ) {
    if (!replicaId) throw new Error('Stock replica identity is required')
    this.state = cloneState(state)
    for (const operation of this.state.operations) this.operations.set(operation.operationId, structuredClone(operation))
    this.snapshotValue = this.recompute()
  }

  static create(replicaId: string, stock: number, prefix: string): EscrowedStock {
    if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('Initial stock must be a non-negative integer')
    return new EscrowedStock(replicaId, initialStockState(stock, replicaId, prefix))
  }

  apply(operation: StockOperation): StockOperationOutcome {
    const existing = this.operations.get(operation.operationId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(operation))
        return { operationId: operation.operationId, status: 'conflict', reason: 'Conflicting stock operation identity' }
      return { operationId: operation.operationId, status: 'duplicate' }
    }
    if (
      operation.kind === 'inventory.transfer' &&
      [...this.operations.values()].some(
        (candidate) => candidate.kind === 'inventory.transfer' && candidate.transferId === operation.transferId,
      )
    )
      return { operationId: operation.operationId, status: 'duplicate', reason: 'Transfer identity was already processed' }
    if (!this.isStructurallyValid(operation))
      return { operationId: operation.operationId, status: 'rejected', reason: 'Invalid stock operation' }
    const before = this.snapshotValue
    this.operations.set(operation.operationId, structuredClone(operation))
    this.state.operations = [...this.operations.values()].sort((left, right) =>
      compareRetailVersions(left.version, right.version),
    )
    this.snapshotValue = this.recompute()
    const changed = JSON.stringify({
      value: before.value,
      availableRights: before.availableRights,
      tokens: before.tokens,
      incrementComponents: before.incrementComponents,
      decrementComponents: before.decrementComponents,
    }) !== JSON.stringify({
      value: this.snapshotValue.value,
      availableRights: this.snapshotValue.availableRights,
      tokens: this.snapshotValue.tokens,
      incrementComponents: this.snapshotValue.incrementComponents,
      decrementComponents: this.snapshotValue.decrementComponents,
    })
    return {
      operationId: operation.operationId,
      status: changed ? 'applied' : 'no-effect',
      ...(changed ? {} : { reason: 'Operation produced no stock state change' }),
    }
  }

  retire(replicaId: string): void {
    if (replicaId && !this.state.retiredReplicaIds.includes(replicaId))
      this.state.retiredReplicaIds.push(replicaId)
  }

  allocate(replicaId: string, count: number): number {
    if (!replicaId || !Number.isSafeInteger(count) || count < 0)
      throw new Error('Invalid stock allocation')
    let remaining = count
    const tokenIds = Object.entries(this.snapshotValue.tokens)
      .filter(([, token]) => token.owner === this.replicaId && !token.consumedBy)
      .map(([tokenId]) => tokenId)
    this.state.allocations ??= {}
    for (const tokenId of tokenIds) {
      if (remaining === 0) break
      this.state.allocations[tokenId] = replicaId
      remaining -= 1
    }
    this.snapshotValue = this.recompute()
    return count - remaining
  }

  availableRights(replicaId = this.replicaId): number {
    return this.snapshotValue.availableRights[replicaId] ?? 0
  }

  value(): number {
    return this.snapshotValue.value
  }

  snapshot(): StockSnapshot {
    return structuredClone(this.snapshotValue)
  }

  stateSnapshot(): EscrowedStockState {
    return cloneState(this.state)
  }

  private isStructurallyValid(operation: StockOperation): boolean {
    if (!operation.operationId || !operation.replicaId || !uniqueTokenIds(operation.tokenIds))
      return false
    if (this.state.retiredReplicaIds.includes(operation.replicaId)) return false
    if (operation.kind === 'inventory.transfer') {
      return Boolean(
        operation.transferId &&
          operation.fromReplicaId &&
          operation.toReplicaId &&
          operation.fromReplicaId !== operation.toReplicaId,
      )
    }
    return true
  }

  private recompute(): StockSnapshot {
    const tokens: Record<string, StockToken> = Object.fromEntries(
      Object.entries(this.state.initialTokens).map(([tokenId, owner]) => [tokenId, { owner }]),
    )
    const incrementComponents: Record<string, number> = {}
    const decrementComponents: Record<string, number> = {}
    const appliedOperationIds = [...this.operations.keys()].sort()

    for (const operation of this.state.operations.sort((left, right) =>
      compareRetailVersions(left.version, right.version),
    )) {
      if (operation.kind === 'inventory.restock') {
        let accepted = 0
        for (const tokenId of operation.tokenIds) {
          if (!tokens[tokenId]) {
            tokens[tokenId] = { owner: operation.replicaId }
            accepted += 1
          }
        }
        for (const [tokenId, owner] of Object.entries(this.state.allocations ?? {})) {
          if (tokens[tokenId] && !tokens[tokenId].consumedBy) tokens[tokenId].owner = owner
        }
        incrementComponents[operation.replicaId] = (incrementComponents[operation.replicaId] ?? 0) + accepted
      } else if (operation.kind === 'inventory.transfer') {
        if (operation.tokenIds.every((tokenId) => tokens[tokenId]?.owner === operation.fromReplicaId && !tokens[tokenId]?.consumedBy)) {
          for (const tokenId of operation.tokenIds) tokens[tokenId].owner = operation.toReplicaId
        }
      } else if (
        operation.tokenIds.every((tokenId) =>
          tokens[tokenId]?.owner === operation.replicaId && !tokens[tokenId]?.consumedBy,
        )
      ) {
        for (const tokenId of operation.tokenIds) tokens[tokenId].consumedBy = operation.operationId
        decrementComponents[operation.replicaId] =
          (decrementComponents[operation.replicaId] ?? 0) + operation.tokenIds.length
      }
    }

    const availableRights: Record<string, number> = {}
    for (const token of Object.values(tokens)) {
      if (!token.consumedBy) availableRights[token.owner] = (availableRights[token.owner] ?? 0) + 1
    }
    const value = Object.values(availableRights).reduce((total, count) => total + count, 0)
    return { value, availableRights, tokens, appliedOperationIds, incrementComponents, decrementComponents }
  }
}
