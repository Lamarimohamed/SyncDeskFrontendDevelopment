import { describe, expect, it } from "vitest"

import { ReplicaRuntime } from "./replica"

describe("replica runtime", () => {
  it("restores exact CRDT metadata without synthetic writes", () => {
    const original = new ReplicaRuntime<"red">("a")

    original.writeRegister("red")

    original.add("red")

    original.incrementCounter(2)

    const restored = ReplicaRuntime.fromJSON(original.snapshot())

    expect(restored.snapshot()).toEqual(original.snapshot())

    expect(restored.replicaId).toBe("a")
  })

  it("does not mutate the source replica during merge", () => {
    const source = new ReplicaRuntime<"red">("source")

    const target = new ReplicaRuntime<"red">("target")

    source.add("red")

    const sourceBefore = source.snapshot()

    target.merge(source)

    expect(source.snapshot()).toEqual(sourceBefore)

    expect(target.set.has("red")).toBe(true)
  })
})
