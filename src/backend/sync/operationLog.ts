import type { VersionedRetailOperation } from "../../domain/retailSync"

export interface LoggedOperation {
  position: number
  operation: VersionedRetailOperation
}

export interface OperationLogState {
  operations: LoggedOperation[]
}

export interface OperationLogStore {
  load(): OperationLogState | undefined
  save(state: OperationLogState): void
}

export class DurableOperationLog {
  private readonly operations: LoggedOperation[]
  private readonly operationPositions = new Map<string, number>()

  constructor(
    private readonly store: OperationLogStore,
    state: OperationLogState = { operations: [] },
  ) {
    this.operations = [...state.operations].sort((a, b) => a.position - b.position)
    for (const entry of this.operations) this.operationPositions.set(entry.operation.operationId, entry.position)
  }

  static load(store: OperationLogStore): DurableOperationLog {
    return new DurableOperationLog(store, store.load() ?? { operations: [] })
  }

  append(operation: VersionedRetailOperation): { status: "accepted" | "duplicate"; position: number } {
    const existing = this.operationPositions.get(operation.operationId)
    if (existing !== undefined) return { status: "duplicate", position: existing }
    const position = (this.operations.at(-1)?.position ?? 0) + 1
    const nextOperations = [...this.operations, { position, operation }]
    this.store.save({ operations: structuredClone(nextOperations) })
    this.operations.push({ position, operation })
    this.operationPositions.set(operation.operationId, position)
    return { status: "accepted", position }
  }

  after(cursor: number, limit: number): { operations: LoggedOperation[]; nextCursor: number; hasMore: boolean } {
    const page = this.operations.filter((entry) => entry.position > cursor).slice(0, limit)
    const nextCursor = page.at(-1)?.position ?? cursor
    return {
      operations: page.map((entry) => structuredClone(entry)),
      nextCursor,
      hasMore: this.operations.some((entry) => entry.position > nextCursor),
    }
  }

  all(): LoggedOperation[] {
    return this.operations.map((entry) => structuredClone(entry))
  }

  size(): number {
    return Buffer.byteLength(JSON.stringify({ operations: this.operations }))
  }

}
