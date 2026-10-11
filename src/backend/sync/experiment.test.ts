import { describe, expect, it } from "vitest"

import { runExperiment } from "./experiment"

describe("experiment runner", () => {
  it("produces reproducible machine-readable measurements", () => {
    const first = runExperiment<string>({
      scenarioId: "partition-recovery",

      seed: 11,

      replicaIds: ["a", "b", "c"],

      operationsPerReplica: 2,
    })

    const second = runExperiment<string>({
      scenarioId: "partition-recovery",

      seed: 11,

      replicaIds: ["a", "b", "c"],

      operationsPerReplica: 2,
    })

    expect(first).toEqual(second)

    expect(first.failed).toBe(false)

    expect(first.messageCount).toBe(6)

    expect(first.encodedPayloadBytes).toBeGreaterThan(0)

    expect(Object.values(first.stateHashes).length).toBe(3)
  })
})
