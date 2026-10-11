import { describe, expect, it } from "vitest"

import { FileReplicaStore, ReplicaStore } from "./ReplicaStore"

import { mkdtempSync, rmSync } from "node:fs"

import { tmpdir } from "node:os"

import { join } from "node:path"

describe("replica persistence", () => {
  it("writes and restores replica state", () => {
    const store = new ReplicaStore()

    const base = { replicaId: "r1", value: "v1" }

    const saved = store.save("r1", base)

    expect(store.load("r1")).toEqual(saved)
  })

  it("loads a stable identity after reinitialization", () => {
    const initial = new Map<string, any>([
      [
        "r1",
        {
          replicaId: "r1",
          state: { value: "v1" },
          schemaVersion: 1,
          updatedAt: 123,
        },
      ],
    ])

    const store = new ReplicaStore(initial)

    expect(store.load("r1")?.state).toEqual({ value: "v1" })
  })

  it("does not expose mutable state stored in memory", () => {
    const store = new ReplicaStore()

    const state = { metadata: { counter: 1 } }

    store.save("r1", state)

    state.metadata.counter = 9

    expect(store.load("r1")?.state).toEqual({ metadata: { counter: 1 } })
  })

  it("restores records from a new file-backed store instance", () => {
    const directory = mkdtempSync(join(tmpdir(), "syncdesk-replica-"))

    const path = join(directory, "replicas.json")

    try {
      new FileReplicaStore(path).save("r1", {
        value: "v1",
        clock: { logicalCounter: 2 },
      })

      expect(new FileReplicaStore(path).load("r1")?.state).toEqual({
        value: "v1",
        clock: { logicalCounter: 2 },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
