export interface HlcTimestamp {
  wallClock: number

  logicalCounter: number

  nodeId: string
}

const isValidTimestamp = (value: HlcTimestamp): boolean =>
  Number.isSafeInteger(value.wallClock) &&
  value.wallClock >= 0 &&
  Number.isSafeInteger(value.logicalCounter) &&
  value.logicalCounter >= 0 &&
  typeof value.nodeId === "string" &&
  value.nodeId.length > 0

export class HybridLogicalClock {
  readonly nodeId: string

  wallClock: number

  logicalCounter: number

  constructor(nodeId: string, wallClock = 0, logicalCounter = 0) {
    if (
      !nodeId ||
      !Number.isSafeInteger(wallClock) ||
      wallClock < 0 ||
      !Number.isSafeInteger(logicalCounter) ||
      logicalCounter < 0
    ) {
      throw new Error("Invalid hybrid logical clock state")
    }

    this.nodeId = nodeId

    this.wallClock = wallClock

    this.logicalCounter = logicalCounter
  }

  static fromJSON(value: HlcTimestamp): HybridLogicalClock {
    if (!isValidTimestamp(value))
      throw new Error("Invalid hybrid logical clock timestamp")

    return new HybridLogicalClock(
      value.nodeId,
      value.wallClock,
      value.logicalCounter,
    )
  }

  static compare(a: HlcTimestamp, b: HlcTimestamp): number {
    if (!isValidTimestamp(a) || !isValidTimestamp(b))
      throw new Error("Invalid hybrid logical clock timestamp")

    if (a.wallClock !== b.wallClock) return a.wallClock - b.wallClock

    if (a.logicalCounter !== b.logicalCounter)
      return a.logicalCounter - b.logicalCounter

    if (a.nodeId === b.nodeId) return 0

    return a.nodeId.localeCompare(b.nodeId)
  }

  tick(nowMs = Date.now()): HlcTimestamp {
    const observedWallClock = Math.max(this.wallClock, nowMs)

    const nextCounter =
      observedWallClock === this.wallClock ? this.logicalCounter + 1 : 0

    this.wallClock = observedWallClock

    this.logicalCounter = nextCounter

    return this.toJSON()
  }

  merge(other: HlcTimestamp | HybridLogicalClock): HlcTimestamp {
    const candidate =
      other instanceof HybridLogicalClock ? other.toJSON() : other

    if (!isValidTimestamp(candidate))
      throw new Error("Invalid hybrid logical clock timestamp")

    const local = this.toJSON()

    const wallClock = Math.max(local.wallClock, candidate.wallClock)

    if (local.wallClock === candidate.wallClock) {
      this.logicalCounter =
        Math.max(local.logicalCounter, candidate.logicalCounter) + 1
    } else if (wallClock === local.wallClock) {
      this.logicalCounter = local.logicalCounter + 1
    } else {
      this.logicalCounter = candidate.logicalCounter + 1
    }

    this.wallClock = wallClock

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
