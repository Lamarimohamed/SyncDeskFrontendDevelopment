import { describe, expect, it } from "vitest"
import { DurableOperationLog, type OperationLogState } from "./operationLog"
import type { VersionedRetailOperation } from "../../domain/retailSync"

const operation = (id: string): VersionedRetailOperation => ({
  schemaVersion: 2,
  operationId: id,
  replicaId: "a",
  version: { logicalTime: Number(id.slice(1)), replicaId: "a", operationId: id },
  kind: "inventory.adjust",
  productId: "p",
  delta: 1,
})

describe("durable operation log", () => {
  it("appends in acceptance order, deduplicates, pages, and restores", () => {
    let saved: OperationLogState | undefined
    const store = { load: () => saved, save: (state: OperationLogState) => { saved = state } }
    const log = DurableOperationLog.load(store)
    expect(log.append(operation("o1"))).toEqual({ status: "accepted", position: 1 })
    expect(log.append(operation("o1"))).toEqual({ status: "duplicate", position: 1 })
    expect(log.append(operation("o2"))).toEqual({ status: "accepted", position: 2 })
    expect(log.after(0, 1)).toMatchObject({ nextCursor: 1, hasMore: true })
    const restored = DurableOperationLog.load(store)
    expect(restored.after(1, 10).operations.map((entry) => entry.operation.operationId)).toEqual(["o2"])
  })
})
