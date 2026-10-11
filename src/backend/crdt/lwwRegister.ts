import { HybridLogicalClock, type HlcTimestamp } from './clock'

export interface LwwRegisterState<T> {
  value: T | null
  timestamp: HlcTimestamp
}

export class LwwRegister<T> {
  private readonly nodeId: string
  private state: LwwRegisterState<T>

  constructor(nodeId: string, initialValue: T | null = null, initialTimestamp?: HlcTimestamp) {
    this.nodeId = nodeId
    this.state = {
      value: initialValue,
      timestamp: initialTimestamp ?? { wallClock: 0, logicalCounter: 0, nodeId },
    }
  }

  write(value: T, nowMs = Date.now()): T {
    const clock = new HybridLogicalClock(this.nodeId, this.state.timestamp.wallClock, this.state.timestamp.logicalCounter)
    const nextTimestamp = clock.tick(nowMs)
    this.state = { value, timestamp: nextTimestamp }
    return value
  }

  merge(other: LwwRegister<T>): T | null {
    if (!this.state.value && !other.state.value) return null
    const winner = HybridLogicalClock.compare(this.state.timestamp, other.state.timestamp) >= 0 ? this.state : other.state
    this.state = { ...winner }
    return this.state.value
  }

  get value(): T | null {
    return this.state.value
  }

  get timestamp(): HlcTimestamp {
    return this.state.timestamp
  }

  toJSON(): LwwRegisterState<T> {
    return { ...this.state }
  }

  static fromJSON<T>(nodeId: string, data: LwwRegisterState<T>): LwwRegister<T> {
    const register = new LwwRegister<T>(nodeId, data.value ?? null, data.timestamp)
    register.state = data
    return register
  }
}
