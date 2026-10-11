import { HybridLogicalClock, type HlcTimestamp } from "./clock"

export interface LwwRegisterState<T> {
  value: T | null

  timestamp: HlcTimestamp
}

export class LwwRegister<T> {
  private readonly nodeId: string

  private state: LwwRegisterState<T>

  constructor(
    nodeId: string,
    initialValue: T | null = null,
    initialTimestamp?: HlcTimestamp,
  ) {
    this.nodeId = nodeId

    this.state = {
      value: initialValue,

      timestamp: initialTimestamp ?? {
        wallClock: 0,
        logicalCounter: 0,
        nodeId,
      },
    }
  }

  write(value: T, nowMs = Date.now()): T {
    const clock = new HybridLogicalClock(
      this.nodeId,
      this.state.timestamp.wallClock,
      this.state.timestamp.logicalCounter,
    )

    const nextTimestamp = clock.tick(nowMs)

    this.state = { value, timestamp: nextTimestamp }

    return value
  }

  merge(other: LwwRegister<T>): T | null {
    const winner =
      HybridLogicalClock.compare(this.state.timestamp, other.state.timestamp) >=
      0
        ? this.state
        : other.state

    this.state = { value: winner.value, timestamp: { ...winner.timestamp } }

    return this.state.value
  }

  get value(): T | null {
    return this.state.value
  }

  get timestamp(): HlcTimestamp {
    return this.state.timestamp
  }

  restore(state: LwwRegister<T>): void {
    this.state = { value: state.value, timestamp: { ...state.timestamp } }
  }

  toJSON(): LwwRegisterState<T> {
    return { ...this.state }
  }

  static fromJSON<T,>(
    nodeId: string,
    data: LwwRegisterState<T>,
  ): LwwRegister<T> {
    if (!data || !data.timestamp || data.timestamp.nodeId.length === 0)
      throw new Error("Invalid LWW register state")

    const register = new LwwRegister<T>(
      nodeId,
      data.value ?? null,
      data.timestamp,
    )

    register.state = { value: data.value, timestamp: { ...data.timestamp } }

    return register
  }
}
