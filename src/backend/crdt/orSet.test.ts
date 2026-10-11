import { describe, expect, it } from "vitest"

import { OrSet } from "./orSet"

describe("observed-remove set", () => {
  it("removes only the tags it has observed", () => {
    const left = new OrSet<"red">("a")

    const right = new OrSet<"red">("b")

    left.add("red")

    right.add("red")

    left.remove("red")

    right.merge(left)

    left.merge(right)

    expect(left.values()).toEqual(["red"])

    expect(right.values()).toEqual(["red"])
  })

  it("keeps concurrently unseen adds alive when they have not been observed removed", () => {
    const left = new OrSet<"red">("a")

    const right = new OrSet<"red">("b")

    left.add("red")

    right.add("red")

    left.merge(right)

    expect(left.values()).toEqual(["red"])
  })

  it("restores the operation counter without sharing serialized tags", () => {
    const original = new OrSet<"red">("a")

    original.add("red")

    const restored = OrSet.fromJSON("a", original.toJSON())

    const tag = restored.add("red")

    expect(tag.counter).toBe(2)

    expect(restored.toJSON()).not.toBe(original.toJSON())
  })
})
