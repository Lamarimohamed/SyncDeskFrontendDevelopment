export interface PnCounterState {
  [replicaId: string]: {
    increment: number

    decrement: number
  }
}

export class PnCounter {
  private readonly replicaId: string

  private state: PnCounterState

  constructor(replicaId: string, initialState: PnCounterState = {}) {
    if (!replicaId) throw new Error("Replica identity is required")

    this.replicaId = replicaId

    this.state = {}

    for (const [id, bucket] of Object.entries(initialState)) {
      if (
        !Number.isSafeInteger(bucket.increment) ||
        bucket.increment < 0 ||
        !Number.isSafeInteger(bucket.decrement) ||
        bucket.decrement < 0
      ) {
        throw new Error("Invalid PN-counter state")
      }

      this.state[id] = { ...bucket }
    }

    this.state[replicaId] ??= { increment: 0, decrement: 0 }
  }

  increment(delta = 1): number {
    const current = this.state[this.replicaId] ?? { increment: 0, decrement: 0 }

    current.increment += delta

    this.state[this.replicaId] = current

    return this.value()
  }

  decrement(delta = 1): number {
    const current = this.state[this.replicaId] ?? { increment: 0, decrement: 0 }

    current.decrement += delta

    this.state[this.replicaId] = current

    return this.value()
  }

  value(): number {
    return Object.values(this.state).reduce(
      (total, bucket) => total + bucket.increment - bucket.decrement,
      0,
    )
  }

  merge(other: PnCounter): void {
    for (const [replicaId, bucket] of Object.entries(other.state)) {
      const current = this.state[replicaId] ?? { increment: 0, decrement: 0 }

      this.state[replicaId] = {
        increment: Math.max(current.increment, bucket.increment),

        decrement: Math.max(current.decrement, bucket.decrement),
      }
    }
  }

  toJSON(): PnCounterState {
    return Object.fromEntries(
      Object.entries(this.state).map(([id, bucket]) => [id, { ...bucket }]),
    )
  }

  static fromJSON(replicaId: string, state: PnCounterState): PnCounter {
    return new PnCounter(replicaId, state)
  }
}
