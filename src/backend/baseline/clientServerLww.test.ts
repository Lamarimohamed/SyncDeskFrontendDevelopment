import { describe, expect, it } from "vitest"

import { ClientServerLwwBaseline } from "./clientServerLww"

describe("client-server LWW baseline", () => {
  it("makes the server authoritative and resolves ties deterministically", () => {
    const baseline = new ClientServerLwwBaseline()

    baseline.registerClient("a")

    baseline.registerClient("b")

    baseline.submit(baseline.createOperation("a", "op-a", "a-value", 100))

    baseline.submit(baseline.createOperation("b", "op-b", "b-value", 100))

    expect(baseline.getState().value).toBe("b-value")

    expect(baseline.getStats().submitted).toBe(2)

    expect(baseline.getStats().conflicts).toBe(0)
  })

  it("buffers disconnected writes and applies them after reconnect", () => {
    const baseline = new ClientServerLwwBaseline()

    baseline.registerClient("a", false)

    const operation = baseline.createOperation("a", "offline-1", "offline", 100)

    baseline.submit(operation)

    expect(baseline.pendingOperationCount()).toBe(1)

    expect(baseline.getState().value).toBeNull()

    baseline.setConnected("a", true)

    expect(baseline.pendingOperationCount()).toBe(0)

    expect(baseline.getState().value).toBe("offline")
  })

  it("does not apply duplicate operation submissions twice", () => {
    const baseline = new ClientServerLwwBaseline()

    baseline.registerClient("a")

    const operation = baseline.createOperation("a", "same", "value", 100)

    baseline.submit(operation)

    baseline.submit(operation)

    expect(baseline.getStats().submitted).toBe(1)
  })
})
