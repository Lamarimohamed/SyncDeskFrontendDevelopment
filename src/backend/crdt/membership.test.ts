import { describe, expect, it } from "vitest"

import { ReplicaMembership } from "./membership"

describe("replica membership", () => {
  it("forgets a replica without allowing identity reuse", () => {
    const membership = new ReplicaMembership(["a", "b", "c"])

    membership.forget("c")

    expect(membership.list()).toEqual(["a", "b"])
    expect(membership.isRetired("c")).toBe(true)
    expect(() => membership.join("c")).toThrow(/cannot be reused/i)
    expect(() => membership.forget("a")).not.toThrow()
    expect(() => membership.forget("b")).toThrow(/last remaining replica/)
  })

  it("admits a fresh replica identity after a forget", () => {
    const membership = new ReplicaMembership(["a", "b"])

    membership.forget("b")
    membership.join("d")

    expect(membership.list()).toEqual(["a", "d"])
    expect(membership.includes("b")).toBe(false)
  })
})
