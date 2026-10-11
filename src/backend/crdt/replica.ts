import { HybridLogicalClock, type HlcTimestamp } from "./clock"

import { LwwRegister } from "./lwwRegister"

import { OrSet, type OrSetState, type Tag } from "./orSet"

import { PnCounter, type PnCounterState } from "./pnCounter"

interface RegisterSnapshot<T extends string> {
  value: T | null
  timestamp: HlcTimestamp
}

export interface ReplicaSnapshot<T extends string> {
  replicaId: string

  clock: HlcTimestamp

  register: RegisterSnapshot<T>

  set: OrSetState<T>

  counter: PnCounterState
}

export class ReplicaRuntime<T extends string> {
  readonly replicaId: string

  readonly clock: HybridLogicalClock

  readonly register: LwwRegister<T>

  readonly set: OrSet<T>

  readonly counter: PnCounter

  constructor(replicaId: string, initialValue?: T | null) {
    if (!replicaId) throw new Error("Replica identity is required")

    this.replicaId = replicaId

    this.clock = new HybridLogicalClock(replicaId)

    this.register = new LwwRegister<T>(replicaId, initialValue ?? null)

    this.set = new OrSet<T>(replicaId)

    this.counter = new PnCounter(replicaId)
  }

  writeRegister(value: T): T {
    this.clock.tick(Date.now())

    return this.register.write(value, Date.now())
  }

  add(value: T): Tag {
    return this.set.add(value)
  }

  remove(value: T): void {
    this.set.remove(value)
  }

  incrementCounter(delta = 1): number {
    return this.counter.increment(delta)
  }

  decrementCounter(delta = 1): number {
    return this.counter.decrement(delta)
  }

  merge(other: ReplicaRuntime<T>): void {
    const mergedClock = this.clock.merge(other.clock)

    this.register.merge(other.register)

    this.set.merge(other.set)

    this.counter.merge(other.counter)
  }

  snapshot(): ReplicaSnapshot<T> {
    return {
      replicaId: this.replicaId,

      clock: this.clock.toJSON(),

      register: this.register.toJSON(),

      set: this.set.toJSON(),

      counter: this.counter.toJSON(),
    }
  }

  static fromJSON<T extends string,>(
    snapshot: ReplicaSnapshot<T>,
  ): ReplicaRuntime<T> {
    if (!snapshot || snapshot.clock.nodeId !== snapshot.replicaId)
      throw new Error("Invalid replica snapshot identity")

    const runtime = new ReplicaRuntime<T>(snapshot.replicaId)

    const restoredClock = HybridLogicalClock.fromJSON(snapshot.clock)

    runtime.clock.wallClock = restoredClock.wallClock

    runtime.clock.logicalCounter = restoredClock.logicalCounter

    const restoredRegister = LwwRegister.fromJSON<T>(
      snapshot.replicaId,
      snapshot.register,
    )

    runtime.register.restore(restoredRegister)

    runtime.set.merge(OrSet.fromJSON<T>(snapshot.replicaId, snapshot.set))

    runtime.counter.merge(
      PnCounter.fromJSON(snapshot.replicaId, snapshot.counter),
    )

    return runtime
  }
}
