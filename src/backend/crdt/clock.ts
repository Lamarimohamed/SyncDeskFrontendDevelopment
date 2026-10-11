export interface HlcTimestamp {
  wallClock: number
  logicalCounter: number
  nodeId: string
}

export class HybridLogicalClock {
  nodeId: string
  wallClock: number
  logicalCounter: number

  constructor(nodeId: string, wallClock = 0, logicalCounter = 0) {
    this.nodeId = nodeId
    this.wallClock = wallClock
    this.logicalCounter = logicalCounter
  }

  static fromJSON(value: HlcTimestamp): HybridLogicalClock {
    return new HybridLogicalClock(value.nodeId, value.wallClock, value.logicalCounter)
  }

  static compare(a: HlcTimestamp, b: HlcTimestamp): number {
    if (a.wallClock !== b.wallClock) return a.wallClock - b.wallClock
    if (a.logicalCounter !== b.logicalCounter) return a.logicalCounter - b.logicalCounter
    if (a.nodeId === b.nodeId) return 0
    return a.nodeId.localeCompare(b.nodeId)
  }

  tick(nowMs = Date.now()): HlcTimestamp {
    const observedWallClock = Math.max(this.wallClock, nowMs)
    const nextCounter = observedWallClock === this.wallClock ? this.logicalCounter + 1 : 0

    this.wallClock = observedWallClock
    this.logicalCounter = nextCounter

    return this.toJSON()
  }

  merge(other: HlcTimestamp | HybridLogicalClock): HlcTimestamp {
    const candidate = other instanceof HybridLogicalClock ? other.toJSON() : other
    const winner = HybridLogicalClock.compare(this.toJSON(), candidate) >= 0 ? this.toJSON() : candidate

    this.wallClock = winner.wallClock
    this.logicalCounter = winner.logicalCounter
    this.nodeId = winner.nodeId

    return this.toJSON()
  }

  toJSON(): HlcTimestamp {
    return {
      wallClock: this.wallClock,
      logicalCounter: this.logicalCounter,
      nodeId: this.nodeId,
    }
  }
}
