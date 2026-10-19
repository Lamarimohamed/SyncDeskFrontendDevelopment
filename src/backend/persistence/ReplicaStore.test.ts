import { describe, expect, it } from "vitest"

import {
  FileReplicaStore,
  FileReplicaStoreLockError,
  ReplicaRevisionConflictError,
  ReplicaStore,
} from "./ReplicaStore"

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"

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

  it("rejects a stale in-memory replacement", () => {
    const store = new ReplicaStore()
    store.save("r1", { value: "v1" })
    const loaded = store.loadWithRevision("r1")

    if (!loaded) throw new Error("Expected a stored record")

    store.save("r1", { value: "v2" })

    expect(() =>
      store.replaceIfRevision("r1", loaded.revision, {
        replicaId: "r1",
        state: { value: "stale" },
        schemaVersion: 2,
        updatedAt: 3,
      }),
    ).toThrow(ReplicaRevisionConflictError)
    expect(store.load("r1")?.state).toEqual({ value: "v2" })
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

  it("rejects a second file-backed writer while preserving the existing record", () => {
    const directory = mkdtempSync(join(tmpdir(), "syncdesk-replica-lock-"))
    const path = join(directory, "replicas.json")

    try {
      const store = new FileReplicaStore(path)
      store.save("r1", { value: "v1" })
      writeFileSync(`${path}.lock`, "test lock", "utf8")

      expect(() => store.save("r1", { value: "should-not-persist" })).toThrow(
        FileReplicaStoreLockError,
      )
      expect(new FileReplicaStore(path).load("r1")?.state).toEqual({
        value: "v1",
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("rejects a stale replacement across independent file store instances", () => {
    const directory = mkdtempSync(join(tmpdir(), "syncdesk-replica-cas-"))
    const path = join(directory, "replicas.json")

    try {
      const first = new FileReplicaStore(path)
      const second = new FileReplicaStore(path)
      first.save("r1", { value: "v1" })
      const firstRead = first.loadWithRevision("r1")
      const secondRead = second.loadWithRevision("r1")

      if (!firstRead || !secondRead) throw new Error("Expected stored records")

      first.save("r1", { value: "v2" })

      expect(() =>
        second.replaceIfRevision("r1", secondRead.revision, {
          replicaId: "r1",
          state: { value: "stale" },
          schemaVersion: 2,
          updatedAt: 3,
        }),
      ).toThrow(ReplicaRevisionConflictError)
      expect(first.load("r1")?.state).toEqual({ value: "v2" })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
