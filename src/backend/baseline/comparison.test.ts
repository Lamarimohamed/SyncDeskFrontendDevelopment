import { describe, expect, it } from "vitest"

import { runComparableScenario } from "./comparison"

describe("comparable CRDT and baseline scenarios", () => {
  it("uses the same deterministic workload and records semantic differences", () => {
    const result = runComparableScenario({
      scenarioId: "offline-reconnect",

      seed: 5,

      replicaIds: ["a", "b", "c"],

      operationsPerReplica: 2,

      disconnectedReplica: "c",
    })

    expect(result.operationCount).toBe(6)

    expect(result.crdt.converged).toBe(true)

    expect(result.crdt.messageCount).toBe(6)

    expect(result.baseline.authoritative).toBe(true)

    expect(result.baseline.buffered).toBe(2)

    expect(result.baseline.submitted).toBe(6)
  })
})
