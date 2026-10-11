import { describe, expect, it } from "vitest"

import { ReplicaRuntime } from "../crdt/replica"

import { createStateMessage, encodeSyncMessage } from "./protocol"

describe("sync protocol measurement boundary", () => {
  it("measures UTF-8 encoded application payload bytes", () => {
    const replica = new ReplicaRuntime<"café">("a")

    replica.add("café")

    const message = createStateMessage("a", "unicode", replica.snapshot())

    const encoded = encodeSyncMessage(message)

    expect(encoded.byteLength).toBeGreaterThan(JSON.stringify(message).length)
  })
})
