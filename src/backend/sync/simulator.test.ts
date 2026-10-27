import { describe, expect, it } from "vitest"

import { ReplicaSimulator } from "./simulator"

describe("deterministic replica simulator", () => {
  it("converges after partitioned updates and complete exchange", () => {
    const simulator = new ReplicaSimulator<string>(7, ["a", "b", "c"])

    simulator.partition("a")

    simulator.update("a", (replica) => {
      replica.add("red")

      replica.incrementCounter(2)
    })

    simulator.update("b", (replica) => {
      replica.add("blue")

      replica.decrementCounter(1)
    })

    simulator.reconnect("a")

    for (const from of simulator.replicaIds) {
      for (const target of simulator.replicaIds) {
        if (from !== target)
          simulator.send(from, target, { duplicate: true, delay: 1 })
      }
    }

    simulator.deliverAll()

    expect(simulator.converge()).toBe(true)

    expect(
      simulator.report(7).events.some((event) => event.type === "duplicate"),
    ).toBe(true)
  })

  it("reproduces the same fault schedule for the same seed", () => {
    const run = () => {
      const simulator = new ReplicaSimulator<string>(42, ["a", "b", "c"])

      simulator.update("a", (replica) => replica.add("red"))

      simulator.update("b", (replica) => replica.add("blue"))

      simulator.sendRandom("a", "b")

      simulator.sendRandom("b", "c")

      simulator.sendRandom("c", "a")

      simulator.deliverAll()

      return simulator.report(42)
    }

    expect(run()).toEqual(run())
  })

  it("collects stable tombstones across all replicas without breaking convergence", () => {
    const simulator = new ReplicaSimulator<string>(3, ["a", "b", "c"])

    simulator.update("a", (replica) => replica.add("red"))
    simulator.update("b", (replica) => replica.add("blue"))

    for (const from of simulator.replicaIds) {
      for (const target of simulator.replicaIds) {
        if (from !== target) simulator.send(from, target)
      }
    }

    simulator.deliverAll()

    simulator.update("a", (replica) => {
      replica.remove("red")
    })

    for (const from of simulator.replicaIds) {
      for (const target of simulator.replicaIds) {
        if (from !== target) simulator.send(from, target)
      }
    }

    simulator.deliverAll()

    expect(simulator.converge()).toBe(true)

    const collected = simulator.collectGarbage()

    expect(collected.a.tombstonesCollected).toBeGreaterThan(0)
    expect(collected.b.tombstonesCollected).toBeGreaterThan(0)
    expect(collected.c.tombstonesCollected).toBeGreaterThan(0)
    expect(simulator.converge()).toBe(true)

    // A post-collection exchange round must not resurrect collected elements.
    for (const from of simulator.replicaIds) {
      for (const target of simulator.replicaIds) {
        if (from !== target) simulator.send(from, target)
      }
    }

    simulator.deliverAll()

    expect(simulator.converge()).toBe(true)
    expect(simulator.report(3).snapshots.a.set.removes).toEqual({})
  })

  it("does not claim convergence while a partition prevents exchange", () => {
    const simulator = new ReplicaSimulator<string>(1, ["a", "b"])

    simulator.partition("b")

    simulator.update("a", (replica) => replica.add("red"))

    simulator.update("b", (replica) => replica.add("blue"))

    simulator.send("a", "b")

    expect(simulator.converge()).toBe(false)
  })
})
