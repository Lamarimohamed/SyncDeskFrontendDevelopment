import { HybridLogicalClock, type HlcTimestamp } from "../crdt/clock"

export interface BaselineOperation {
  operationId: string

  clientId: string

  value: string

  timestamp: HlcTimestamp
}

export interface BaselineStats {
  submitted: number

  applied: number

  conflicts: number

  rejected: number

  buffered: number
}

export interface BaselineState {
  value: string | null

  timestamp: HlcTimestamp
}

export class ClientServerLwwBaseline {
  private readonly clients = new Map<string, HybridLogicalClock>()

  private readonly buffers = new Map<string, BaselineOperation[]>()

  private readonly seenOperationIds = new Set<string>()

  private state: BaselineState = {
    value: null,

    timestamp: { wallClock: 0, logicalCounter: 0, nodeId: "server" },
  }

  private connected = new Set<string>()

  private stats: BaselineStats = {
    submitted: 0,

    applied: 0,

    conflicts: 0,

    rejected: 0,

    buffered: 0,
  }

  registerClient(clientId: string, connected = true): void {
    if (!clientId || this.clients.has(clientId))
      throw new Error(`Invalid or duplicate client: ${clientId}`)

    this.clients.set(clientId, new HybridLogicalClock(clientId))

    this.buffers.set(clientId, [])

    if (connected) this.connected.add(clientId)
  }

  createOperation(
    clientId: string,
    operationId: string,
    value: string,
    nowMs: number,
  ): BaselineOperation {
    const clock = this.clients.get(clientId)

    if (!clock) throw new Error(`Unknown client: ${clientId}`)

    return { operationId, clientId, value, timestamp: clock.tick(nowMs) }
  }

  setConnected(clientId: string, connected: boolean): void {
    if (!this.clients.has(clientId))
      throw new Error(`Unknown client: ${clientId}`)

    if (connected) {
      this.connected.add(clientId)

      for (const operation of this.buffers.get(clientId) ?? [])
        this.submit(operation)

      this.buffers.set(clientId, [])
    } else {
      this.connected.delete(clientId)
    }
  }

  submit(operation: BaselineOperation): void {
    if (!this.clients.has(operation.clientId)) {
      this.stats.rejected += 1

      throw new Error(`Unknown client: ${operation.clientId}`)
    }

    if (this.seenOperationIds.has(operation.operationId)) return

    if (!this.connected.has(operation.clientId)) {
      this.buffers
        .get(operation.clientId)!
        .push({ ...operation, timestamp: { ...operation.timestamp } })

      this.stats.buffered += 1

      return
    }

    this.seenOperationIds.add(operation.operationId)

    this.stats.submitted += 1

    const comparison = HybridLogicalClock.compare(
      operation.timestamp,
      this.state.timestamp,
    )

    if (comparison > 0) {
      this.state = {
        value: operation.value,
        timestamp: { ...operation.timestamp },
      }

      this.stats.applied += 1
    } else {
      this.stats.conflicts += 1
    }
  }

  getState(): BaselineState {
    return { value: this.state.value, timestamp: { ...this.state.timestamp } }
  }

  getStats(): BaselineStats {
    return { ...this.stats }
  }

  pendingOperationCount(): number {
    return [...this.buffers.values()].reduce(
      (total, buffer) => total + buffer.length,
      0,
    )
  }
}
