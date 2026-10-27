import { describe, expect, it } from "vitest"

import { OrSet, type OrSetState } from "./orSet"

type Value = "x" | "y"

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )

  return value
}

// Semantic state that must converge between replicas: element tags,
// tombstones, and the remove-event knowledge vector. The observation matrix
// and the local add-counter watermark are per-replica bookkeeping and are
// deliberately excluded from convergence comparisons.
const semantic = (set: OrSet<Value>): string => {
  const state = set.toJSON()

  return JSON.stringify(
    canonicalize({ adds: state.adds, removes: state.removes, removeVector: state.removeVector }),
  )
}

describe("or-set causal-stability garbage collection", () => {
  it("collects stable tombstones after full exchange and never resurrects", () => {
    const a = new OrSet<Value>("a")
    const b = new OrSet<Value>("b")
    const c = new OrSet<Value>("c")

    a.add("x")

    b.merge(a)
    c.merge(a)

    expect(a.remove("x")).toEqual({ replicaId: "a", counter: 1 })

    b.merge(a)
    c.merge(a)
    a.merge(b)
    a.merge(c)
    b.merge(c)
    c.merge(b)

    expect(a.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })
    expect(b.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })
    expect(c.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })

    expect(a.values()).toEqual([])
    expect(b.values()).toEqual([])
    expect(c.values()).toEqual([])

    a.merge(b)
    b.merge(c)
    c.merge(a)

    expect(a.values()).toEqual([])
    expect(b.values()).toEqual([])
    expect(c.values()).toEqual([])
    expect(a.stats().tombstoneCount).toBe(0)
  })

  it("blocks collection while a replica has not been observed to know the remove", () => {
    const a = new OrSet<Value>("a")
    const b = new OrSet<Value>("b")
    const c = new OrSet<Value>("c")

    a.add("x")

    b.merge(a)
    c.merge(a)

    a.remove("x")

    b.merge(a)

    expect(a.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 0,
      tagsCollected: 0,
    })
    expect(b.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 0,
      tagsCollected: 0,
    })

    c.merge(a)
    a.merge(b)
    a.merge(c)
    b.merge(c)
    c.merge(b)

    expect(a.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })
    expect(b.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })
    expect(c.garbageCollect(["a", "b", "c"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })

    c.merge(a)

    expect(c.values()).toEqual([])
  })

  it("keeps concurrent re-adds alive while collecting covered tags", () => {
    const a = new OrSet<Value>("a")
    const b = new OrSet<Value>("b")

    a.add("x")

    b.merge(a)

    a.remove("x")

    const concurrentTag = b.add("x")

    b.merge(a)

    expect(b.values()).toEqual(["x"])

    a.merge(b)

    expect(a.garbageCollect(["a", "b"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })
    expect(b.garbageCollect(["a", "b"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })

    expect(a.values()).toEqual(["x"])
    expect(b.values()).toEqual(["x"])
    expect(a.stats().addTagCount).toBe(1)
    expect(b.stats().addTagCount).toBe(1)
    expect(concurrentTag.counter).toBe(1)

    a.merge(b)
    b.merge(a)

    expect(a.values()).toEqual(["x"])
    expect(b.values()).toEqual(["x"])
  })

  it("preserves collection eligibility across restart and never reuses tag counters", () => {
    const a = new OrSet<Value>("a")
    const b = new OrSet<Value>("b")

    a.add("x")
    a.add("y")

    b.merge(a)

    a.remove("x")
    a.remove("y")

    b.merge(a)
    a.merge(b)

    const restored = OrSet.fromJSON<Value>("a", a.toJSON())

    expect(restored.garbageCollect(["a", "b"])).toEqual({
      tombstonesCollected: 2,
      tagsCollected: 2,
    })

    const tag = restored.add("x")

    expect(tag.counter).toBe(3)

    b.merge(restored)
    b.garbageCollect(["a", "b"])

    expect(b.values()).toEqual(["x"])
    expect(b.stats().tombstoneCount).toBe(0)
    expect(b.stats().addTagCount).toBe(1)
  })

  it("converges to identical collected semantic states under different merge orders", () => {
    const build = (order: "forward" | "reverse"): string => {
      const a = new OrSet<Value>("a")
      const b = new OrSet<Value>("b")
      const c = new OrSet<Value>("c")

      a.add("x")
      b.add("x")
      c.add("y")

      a.merge(b)
      b.merge(c)
      c.merge(a)

      a.remove("x")

      const forward = [
        [a, b],
        [b, a],
        [a, c],
        [c, a],
        [b, c],
        [c, b],
      ] as const

      const reverse = [
        [c, b],
        [b, c],
        [c, a],
        [a, c],
        [b, a],
        [a, b],
      ] as const

      for (const [from, target] of order === "forward" ? forward : reverse)
        target.merge(from)

      // Observable values converge regardless of merge order.
      expect(a.values()).toEqual(["y"])
      expect(b.values()).toEqual(["y"])
      expect(c.values()).toEqual(["y"])

      a.garbageCollect(["a", "b", "c"])
      b.garbageCollect(["a", "b", "c"])
      c.garbageCollect(["a", "b", "c"])

      // A final full-mesh exchange round completes every replica's direct
      // observation matrix, so a second collection round converges the
      // retained semantic state everywhere.
      const finalRound = [
        [a, b],
        [b, a],
        [a, c],
        [c, a],
        [b, c],
        [c, b],
      ] as const

      for (const [from, target] of finalRound) target.merge(from)

      a.garbageCollect(["a", "b", "c"])
      b.garbageCollect(["a", "b", "c"])
      c.garbageCollect(["a", "b", "c"])

      return semantic(a) + "|" + semantic(b) + "|" + semantic(c)
    }

    const forward = build("forward")
    const reverse = build("reverse")

    expect(forward).toBe(reverse)
    expect(forward).not.toContain('"x"')
    expect(forward).toContain('"y"')
  })

  it("never collects legacy tombstones without a covering remove event", () => {
    const legacyState: OrSetState<Value> = {
      adds: { x: [{ replicaId: "a", counter: 1 }] },
      removes: { x: [{ replicaId: "a", counter: 1 }] },
    }

    const restored = OrSet.fromJSON<Value>("a", legacyState)

    expect(restored.values()).toEqual([])
    expect(restored.garbageCollect(["a", "b"])).toEqual({
      tombstonesCollected: 0,
      tagsCollected: 0,
    })
    expect(restored.stats().tombstoneCount).toBe(1)
  })

  it("resolves a doubly tombstoned tag to the greatest covering event deterministically", () => {
    const a = new OrSet<Value>("a")
    const b = new OrSet<Value>("b")

    a.add("x")

    b.merge(a)

    a.remove("x")
    b.remove("x")

    a.merge(b)
    b.merge(a)

    expect(semantic(a)).toBe(semantic(b))
    expect(a.toJSON().removes.x?.[0]?.removedBy).toEqual({
      replicaId: "b",
      counter: 1,
    })

    a.garbageCollect(["a", "b"])
    b.garbageCollect(["a", "b"])

    expect(a.values()).toEqual([])
    expect(b.values()).toEqual([])
  })

  it("is idempotent and rejects incomplete membership", () => {
    const a = new OrSet<Value>("a")
    const b = new OrSet<Value>("b")

    a.add("x")
    b.merge(a)
    a.remove("x")
    b.merge(a)
    a.merge(b)

    expect(a.garbageCollect(["a", "b"])).toEqual({
      tombstonesCollected: 1,
      tagsCollected: 1,
    })
    expect(a.garbageCollect(["a", "b"])).toEqual({
      tombstonesCollected: 0,
      tagsCollected: 0,
    })
    expect(() => a.garbageCollect([])).toThrow()
    expect(() => a.garbageCollect(["b"])).toThrow()
  })

  it("rejects malformed remove events during restoration", () => {
    const invalid: OrSetState<Value> = {
      adds: {},
      removes: {
        x: [
          {
            replicaId: "a",
            counter: 1,
            removedBy: { replicaId: "a", counter: 0 },
          },
        ],
      },
    }

    expect(() => OrSet.fromJSON<Value>("a", invalid)).toThrow(
      "Invalid OR-Set remove event",
    )
  })
})
