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
    this.replicaId = replicaId
    this.state = { ...initialState }
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
    return Object.values(this.state).reduce((total, bucket) => total + bucket.increment - bucket.decrement, 0)
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
    return { ...this.state }
  }

  static fromJSON(replicaId: string, state: PnCounterState): PnCounter {
    return new PnCounter(replicaId, state)
  }
}
