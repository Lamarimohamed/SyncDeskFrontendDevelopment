import { describe, expect, it } from "vitest"

import { HybridLogicalClock } from "./clock"

describe("hybrid logical clock", () => {
  it("monotonically advances local time", () => {
    const clock = new HybridLogicalClock("n1", 10, 3)

    const t1 = clock.tick(10)

    const t2 = clock.tick(11)

    expect(t1.wallClock).toBe(10)

    expect(t1.logicalCounter).toBe(4)

    expect(t2.wallClock).toBe(11)

    expect(t2.logicalCounter).toBe(0)
  })

  it("orders concurrent events deterministically by node id when clock values match", () => {
    const a = { wallClock: 100, logicalCounter: 7, nodeId: "n1" }

    const b = { wallClock: 100, logicalCounter: 7, nodeId: "n2" }

    expect(HybridLogicalClock.compare(a, b)).toBeLessThan(0)

    expect(HybridLogicalClock.compare(b, a)).toBeGreaterThan(0)
  })

  it("observes remote timestamps without changing local identity", () => {
    const clock = new HybridLogicalClock("local", 10, 2)

    const observed = clock.merge({
      wallClock: 20,
      logicalCounter: 4,
      nodeId: "remote",
    })

    expect(clock.nodeId).toBe("local")

    expect(observed).toEqual({
      wallClock: 20,
      logicalCounter: 5,
      nodeId: "local",
    })
  })

  it("rejects malformed timestamps", () => {
    expect(() =>
      HybridLogicalClock.fromJSON({
        wallClock: -1,
        logicalCounter: 0,
        nodeId: "a",
      }),
    ).toThrow()
  })

  it("keeps logical time monotonic when the wall clock regresses", () => {
    const clock = new HybridLogicalClock("a", 100, 2)

    expect(clock.tick(50)).toEqual({
      wallClock: 100,
      logicalCounter: 3,
      nodeId: "a",
    })
  })
})
