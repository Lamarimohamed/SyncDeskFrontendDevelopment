import { describe, expect, it } from "vitest"

import { ReplicaRuntime } from "../crdt/replica"

import { createStateMessage } from "./protocol"
import { ReliableSyncEndpoint, ReliableSyncSender } from "./reliability"

describe("reliable synchronization endpoint", () => {
  it("applies a message once and acknowledges retries as duplicates", () => {
    const source = new ReplicaRuntime<"red">("source")

    source.add("red")

    const target = new ReliableSyncEndpoint(new ReplicaRuntime<"red">("target"))

    const message = createStateMessage("source", "message-1", source.snapshot())

    const first = target.receive(message)

    const retry = target.receive(message)

    expect(first.applied).toBe(true)

    expect(first.acknowledgement.status).toBe("applied")

    expect(retry.applied).toBe(false)

    expect(retry.acknowledgement.status).toBe("duplicate")

    expect(target.replica.set.values()).toEqual(["red"])
  })

  it("restores deduplication state after an endpoint restart", () => {
    const source = new ReplicaRuntime<"red">("source")

    const message = createStateMessage("source", "message-1", source.snapshot())

    const first = new ReliableSyncEndpoint(new ReplicaRuntime<"red">("target"))

    first.receive(message)

    const restarted = new ReliableSyncEndpoint(
      new ReplicaRuntime<"red">("target"),
    )

    restarted.restoreAppliedMessageIds(first.appliedMessageIdSnapshot())

    expect(restarted.receive(message).acknowledgement.status).toBe("duplicate")
  })

  it("rejects malformed and oversized messages", () => {
    const endpoint = new ReliableSyncEndpoint(
      new ReplicaRuntime<"red">("target"),
    )

    expect(() => endpoint.receive({ type: "state", version: 99 })).toThrow()

    expect(() =>
      endpoint.receive({
        type: "state",

        protocol: "syncdesk-state",

        version: 1,

        messageId: "large",

        fromReplicaId: "source",

        snapshot: { value: "x".repeat(2_000_000) },
      }),
    ).toThrow()
  })

  it("retries the same message ID and bounds retries", () => {
    const source = new ReplicaRuntime<"red">("source")
    const sender = new ReliableSyncSender<"red">({ maxRetries: 1 })
    const message = createStateMessage("source", "retry-1", source.snapshot())

    sender.track(message)
    expect(sender.retry("retry-1")?.byteLength).toBeGreaterThan(0)
    expect(() => sender.retry("retry-1")).toThrow("Retry limit exceeded")
    expect(sender.pendingMessageIds()).toEqual([])
  })
})
