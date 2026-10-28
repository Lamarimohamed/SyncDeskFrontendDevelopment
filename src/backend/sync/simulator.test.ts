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

    // Causal-stability needs a second exchange so each replica observes every
    // other replica's knowledge vector covering the remove.
    simulator.fullMesh()
    simulator.deliverAll()

    const collected = simulator.collectGarbage()

    expect(collected.a.tombstonesCollected).toBeGreaterThan(0)
    expect(collected.b.tombstonesCollected).toBeGreaterThan(0)
    expect(collected.c.tombstonesCollected).toBeGreaterThan(0)
    expect(simulator.converge()).toBe(true)

    // A post-collection exchange round must not resurrect collected elements.
    simulator.fullMesh()
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

  it("blocks collection while a partitioned replica remains in membership", () => {
    const simulator = new ReplicaSimulator<string>(5, ["a", "b", "c"])

    simulator.update("a", (replica) => replica.add("red"))
    simulator.fullMesh()
    simulator.deliverAll()

    simulator.partition("c")
    simulator.update("a", (replica) => replica.remove("red"))
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.fullMesh()
    simulator.deliverAll()

    expect(simulator.collectGarbage().a.tombstonesCollected).toBe(0)

    simulator.reconnect("c")
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.fullMesh()
    simulator.deliverAll()

    expect(simulator.collectGarbage().a.tombstonesCollected).toBeGreaterThan(0)
    expect(simulator.report(5).snapshots.a.set.adds.red).toBeUndefined()
    expect(simulator.converge()).toBe(true)
  })

  it("rejects stale state from a forgotten replica instead of resurrecting deletes", () => {
    const simulator = new ReplicaSimulator<string>(9, ["a", "b", "c"])

    simulator.update("a", (replica) => replica.add("red"))
    simulator.fullMesh()
    simulator.deliverAll()

    simulator.partition("c")
    simulator.update("a", (replica) => replica.remove("red"))
    simulator.fullMesh()
    simulator.deliverAll()

    simulator.forgetReplica("c")
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.fullMesh()
    simulator.deliverAll()

    expect(simulator.collectGarbage().a.tombstonesCollected).toBeGreaterThan(0)

    simulator.reconnect("c")
    simulator.send("c", "a")
    simulator.deliverAll()

    expect(simulator.report(9).events.some((event) => event.type === "reject")).toBe(
      true,
    )
    expect(simulator.report(9).snapshots.a.set.adds.red).toBeUndefined()
    expect(simulator.converge()).toBe(true)
  })

  it("admits a new replica identity after forget and converges without revival", () => {
    const simulator = new ReplicaSimulator<string>(2, ["a", "b"])

    simulator.update("a", (replica) => replica.add("red"))
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.update("a", (replica) => replica.remove("red"))
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.collectGarbage()

    simulator.forgetReplica("b")
    simulator.joinReplica("d")
    simulator.fullMesh()
    simulator.deliverAll()
    simulator.fullMesh()
    simulator.deliverAll()

    expect(simulator.report(2).snapshots.d.set.adds.red).toBeUndefined()
    expect(simulator.converge()).toBe(true)
    expect(() => simulator.joinReplica("b")).toThrow()
  })
})

