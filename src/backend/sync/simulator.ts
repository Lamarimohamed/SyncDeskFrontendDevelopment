import {
  createStateMessage,
  validateStateMessage,
  type StateSyncMessage,
} from "./protocol"

import { ReplicaRuntime, type ReplicaSnapshot } from "../crdt/replica"

export interface SimulatorEvent {
  type: "update" | "send" | "deliver" | "drop" | "duplicate" | "restart" | "gc"

  replicaId?: string

  targetReplicaId?: string

  messageId?: string

  detail?: string
}

export interface NetworkFaults {
  drop?: boolean

  duplicate?: boolean

  delay?: number
}

export interface SimulatorReport<T extends string> {
  seed: number
  virtualTimeMs: number

  replicaIds: string[]

  events: SimulatorEvent[]

  converged: boolean

  snapshots: Record<string, ReplicaSnapshot<T>>
}

class DeterministicRandom {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0

    return this.state / 0x100000000
  }
}

interface QueuedMessage<T extends string> {
  deliverAt: number

  sequence: number

  target: string

  message: StateSyncMessage<T>
}

export class ReplicaSimulator<T extends string> {
  private readonly random: DeterministicRandom

  private readonly replicas = new Map<string, ReplicaRuntime<T>>()

  private readonly partitions = new Set<string>()

  private readonly queue: QueuedMessage<T>[] = []

  private readonly events: SimulatorEvent[] = []

  private sequence = 0

  private messageSequence = 0

  private virtualTime = 0

  constructor(seed: number, replicaIds = ["r1", "r2", "r3", "r4"]) {
    if (!Number.isInteger(seed))
      throw new Error("Simulator seed must be an integer")

    if (
      new Set(replicaIds).size !== replicaIds.length ||
      replicaIds.some((id) => !id)
    )
      throw new Error("Replica identities must be unique")

    this.random = new DeterministicRandom(seed >>> 0)

    replicaIds.forEach((id) => this.replicas.set(id, new ReplicaRuntime<T>(id)))
  }

  get replicaIds(): string[] {
    return [...this.replicas.keys()]
  }

  update(
    replicaId: string,
    operation: (replica: ReplicaRuntime<T>) => void,
  ): void {
    const replica = this.requireReplica(replicaId)

    operation(replica)

    this.events.push({ type: "update", replicaId })
  }

  partition(replicaId: string, isolated = true): void {
    this.requireReplica(replicaId)

    if (isolated) this.partitions.add(replicaId)
    else this.partitions.delete(replicaId)
  }

  reconnect(replicaId: string): void {
    this.partition(replicaId, false)
  }

  send(
    fromReplicaId: string,
    targetReplicaId: string,
    faults: NetworkFaults = {},
  ): void {
    this.requireReplica(fromReplicaId)

    this.requireReplica(targetReplicaId)

    if (
      this.partitions.has(fromReplicaId) ||
      this.partitions.has(targetReplicaId)
    ) {
      this.events.push({
        type: "drop",
        replicaId: fromReplicaId,
        targetReplicaId,
        detail: "partition",
      })

      return
    }

    const message = createStateMessage(
      fromReplicaId,
      `m${++this.messageSequence}`,
      this.requireReplica(fromReplicaId).snapshot(),
    )

    if (faults.drop) {
      this.events.push({
        type: "drop",
        replicaId: fromReplicaId,
        targetReplicaId,
        messageId: message.messageId,
      })

      return
    }

    const queued: QueuedMessage<T> = {
      deliverAt: this.virtualTime + (faults.delay ?? 0),
      sequence: ++this.sequence,
      target: targetReplicaId,
      message,
    }

    this.queue.push(queued)

    this.events.push({
      type: "send",
      replicaId: fromReplicaId,
      targetReplicaId,
      messageId: message.messageId,
    })

    if (faults.duplicate) {
      this.queue.push({ ...queued, sequence: ++this.sequence })

      this.events.push({
        type: "duplicate",
        replicaId: fromReplicaId,
        targetReplicaId,
        messageId: message.messageId,
      })
    }
  }

  sendRandom(fromReplicaId: string, targetReplicaId: string): void {
    this.send(fromReplicaId, targetReplicaId, {
      drop: this.random.next() < 0.2,

      duplicate: this.random.next() < 0.25,

      delay: Math.floor(this.random.next() * 5),
    })
  }

  deliverNext(): boolean {
    if (!this.queue.length) return false

    this.queue.sort(
      (a, b) => a.deliverAt - b.deliverAt || a.sequence - b.sequence,
    )

    const queued = this.queue.shift()!

    this.virtualTime = Math.max(this.virtualTime, queued.deliverAt)

    const target = this.requireReplica(queued.target)

    target.merge(ReplicaRuntime.fromJSON(queued.message.snapshot))

    this.events.push({
      type: "deliver",
      replicaId: queued.message.fromReplicaId,
      targetReplicaId: queued.target,
      messageId: queued.message.messageId,
    })

    return true
  }

  deliverAll(): void {
    while (this.deliverNext()) {}
  }

  restart(replicaId: string): void {
    const replica = this.requireReplica(replicaId)

    this.replicas.set(replicaId, ReplicaRuntime.fromJSON(replica.snapshot()))

    this.events.push({ type: "restart", replicaId })
  }

  collectGarbage(): Record<
    string,
    { tombstonesCollected: number; tagsCollected: number }
  > {
    const collected: Record<
      string,
      { tombstonesCollected: number; tagsCollected: number }
    > = {}

    for (const replicaId of this.replicas.keys()) {
      collected[replicaId] = this.requireReplica(replicaId).garbageCollect([
        ...this.replicas.keys(),
      ])

      this.events.push({ type: "gc", replicaId })
    }

    return collected
  }

  converge(): boolean {
    const snapshots = this.replicaIds.map((id) => {
      const snapshot = this.requireReplica(id).snapshot()

      // Convergence compares the replicated semantic state. OR-Set
      // observation matrices and add-counter watermarks are per-replica
      // bookkeeping and are expected to differ between replicas.
      const set = snapshot.set

      return JSON.stringify(
        canonicalize({
          register: snapshot.register,
          set: {
            adds: set.adds,
            removes: set.removes,
            removeVector: set.removeVector,
          },
          counter: snapshot.counter,
        }),
      )
    })

    return snapshots.every((snapshot) => snapshot === snapshots[0])
  }

  report(seed: number): SimulatorReport<T> {
    return {
      seed,
      virtualTimeMs: this.virtualTime,

      replicaIds: this.replicaIds,

      events: this.events.map((event) => ({ ...event })),

      converged: this.converge(),

      snapshots: Object.fromEntries(
        this.replicaIds.map((id) => [id, this.requireReplica(id).snapshot()]),
      ),
    }
  }

  validate(message: unknown): StateSyncMessage<T> {
    return validateStateMessage<T>(message)
  }

  private requireReplica(replicaId: string): ReplicaRuntime<T> {
    const replica = this.replicas.get(replicaId)

    if (!replica) throw new Error(`Unknown replica: ${replicaId}`)

    return replica
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }

  return value
}
