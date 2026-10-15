import { request } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { createStateMessage } from "../sync/protocol"
import { ReplicaRuntime } from "../crdt/replica"
import { FileReplicaStore, ReplicaStore } from "../persistence/ReplicaStore"
import {
  createBackendServer,
  createFileBackedStore,
  createStoreFromEnvironment,
  PERSISTENCE_FAILURE_RESPONSE,
  startBackendServer,
} from "./server"

const httpRequest = (
  port: number,
  method: string,
  path: string,
  body?: unknown,
  raw = false,
): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : raw ? String(body) : JSON.stringify(body)
    const client = request(
      { host: "127.0.0.1", port, method, path, headers: encoded ? { "content-type": "application/json" } : undefined },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
            })
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    client.on("error", reject)
    client.end(encoded)
  })

describe("backend HTTP API", () => {
  it("reports health and an empty replica state", async () => {
    const backend = await startBackendServer({ port: 0 })
    try {
      const health = await httpRequest(backend.port, "GET", "/health")
      expect(health).toEqual({ status: 200, body: { status: "ok", apiVersion: "1" } })

      const state = await httpRequest(backend.port, "GET", "/v1/replica")
      expect(state.status).toBe(200)
      expect(state.body).toMatchObject({ replicaId: "backend-replica", persisted: false })
    } finally {
      await backend.close()
    }
  })

  it("applies a valid state message and treats a repeated message as a duplicate", async () => {
    const backend = await startBackendServer({ port: 0 })
    const source = new ReplicaRuntime<string>("source")
    source.add("café")
    source.incrementCounter()
    const message = createStateMessage("source", "message-1", source.snapshot())

    try {
      const first = await httpRequest(backend.port, "POST", "/v1/sync/messages", message)
      expect(first.status).toBe(200)
      expect(first.body).toMatchObject({
        applied: true,
        acknowledgement: { status: "applied", messageId: "message-1" },
      })

      const duplicate = await httpRequest(backend.port, "POST", "/v1/sync/messages", message)
      expect(duplicate.status).toBe(200)
      expect(duplicate.body).toMatchObject({
        applied: false,
        acknowledgement: { status: "duplicate", messageId: "message-1" },
      })

      const state = await httpRequest(backend.port, "GET", "/v1/replica")
      expect(state.body).toMatchObject({
        snapshot: { set: { adds: { café: [{ replicaId: "source", counter: 1 }] } } },
        persisted: true,
      })
    } finally {
      await backend.close()
    }
  })

  it("rejects malformed messages and oversized request bodies", async () => {
    const backend = await startBackendServer({ port: 0, bodyLimitBytes: 32 })
    try {
      const malformedJson = await httpRequest(backend.port, "POST", "/v1/sync/messages", "{", true)
      expect(malformedJson).toEqual({
        status: 400,
        body: { error: { code: "invalid_json", message: "Request body must contain valid JSON" } },
      })

      const malformed = await httpRequest(backend.port, "POST", "/v1/sync/messages", { type: "unknown" })
      expect(malformed).toEqual({
        status: 400,
        body: { error: { code: "invalid_sync_message", message: "The synchronization message is invalid" } },
      })

      const oversized = await httpRequest(backend.port, "POST", "/v1/sync/messages", { payload: "x".repeat(100) })
      expect(oversized).toMatchObject({ status: 413, body: { error: { code: "request_too_large" } } })

      await backend.close()
      const validationBackend = await startBackendServer({ port: 0 })
      const source = new ReplicaRuntime<string>("source")
      const message = createStateMessage("source", "invalid-message", source.snapshot())
      try {
        const unsupportedVersion = await httpRequest(
          validationBackend.port,
          "POST",
          "/v1/sync/messages",
          { ...message, version: 99 },
        )
        expect(unsupportedVersion).toEqual({
          status: 400,
          body: { error: { code: "invalid_sync_message", message: "The synchronization message is invalid" } },
        })

        const incompleteSnapshot = await httpRequest(
          validationBackend.port,
          "POST",
          "/v1/sync/messages",
          { ...message, messageId: "incomplete-message", snapshot: { replicaId: "source" } },
        )
        expect(incompleteSnapshot).toEqual({
          status: 400,
          body: { error: { code: "invalid_sync_message", message: "The synchronization message is invalid" } },
        })
      } finally {
        await validationBackend.close()
      }
    } finally {
      await backend.close()
    }
  })

  it("serializes concurrent writes through one endpoint", async () => {
    const backend = await startBackendServer({ port: 0 })
    try {
      const messages = ["a", "b", "c"].map((value, index) => {
        const source = new ReplicaRuntime<string>(`source-${value}`)
        source.add(value)
        return createStateMessage(`source-${value}`, `message-${index}`, source.snapshot())
      })
      const responses = await Promise.all(messages.map((message) => httpRequest(backend.port, "POST", "/v1/sync/messages", message)))
      expect(responses.every((response) => response.status === 200)).toBe(true)
    } finally {
      await backend.close()
    }
  })

  it("can be created without listening for composition tests", () => {
    const backend = createBackendServer({ port: 0 })
    expect(backend.server.listening).toBe(false)
  })

  it("does not publish state when persistence fails and retries after recovery", async () => {
    let fail = true
    const records = new Map<string, { replicaId: string; state: unknown; schemaVersion: number; updatedAt: number }>()
    const store = {
      load: (replicaId: string) => records.get(replicaId),
      save: (replicaId: string, state: unknown) => {
        if (fail) throw new Error("simulated failure")
        const record = { replicaId, state, schemaVersion: 1, updatedAt: 1 }
        records.set(replicaId, record)
        return record
      },
    }
    const backend = await startBackendServer({ port: 0, store })
    const source = new ReplicaRuntime<string>("failure-source")
    source.add("value")
    const message = createStateMessage("failure-source", "failure-message", source.snapshot())

    try {
      const failed = await httpRequest(backend.port, "POST", "/v1/sync/messages", message)
      expect(failed).toEqual({
        status: 503,
        body: { error: PERSISTENCE_FAILURE_RESPONSE },
      })

      const afterFailure = await httpRequest(backend.port, "GET", "/v1/replica")
      expect(afterFailure.body).toMatchObject({
        persisted: false,
        snapshot: { set: { adds: {} } },
      })

      fail = false
      const recovered = await httpRequest(backend.port, "POST", "/v1/sync/messages", message)
      expect(recovered.status).toBe(200)
      expect(recovered.body).toMatchObject({
        applied: true,
        acknowledgement: { status: "applied", messageId: "failure-message" },
      })
    } finally {
      await backend.close()
    }
  })

  it("restores file-backed state and duplicate IDs after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "syncdesk-api-"))
    const path = join(directory, "replicas.json")
    const store = createFileBackedStore(path)
    const source = new ReplicaRuntime<string>("restart-source")
    source.add("persisted-value")
    const message = createStateMessage("restart-source", "restart-message", source.snapshot())
    const first = await startBackendServer({ port: 0, store, replicaId: "restart-backend" })

    try {
      const applied = await httpRequest(first.port, "POST", "/v1/sync/messages", message)
      expect(applied.status).toBe(200)
      await first.close()

      const second = await startBackendServer({ port: 0, store, replicaId: "restart-backend" })
      try {
        const state = await httpRequest(second.port, "GET", "/v1/replica")
        expect(state.body).toMatchObject({
          persisted: true,
          snapshot: { set: { adds: { "persisted-value": [{ replicaId: "restart-source", counter: 1 }] } } },
        })
        const duplicate = await httpRequest(second.port, "POST", "/v1/sync/messages", message)
        expect(duplicate.body).toMatchObject({
          applied: false,
          acknowledgement: { status: "duplicate", messageId: "restart-message" },
        })
      } finally {
        await second.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("selects file-backed or memory storage from BACKEND_STORE_PATH", async () => {
    const directory = await mkdtemp(join(tmpdir(), "syncdesk-selection-"))
    const path = join(directory, "replicas.json")
    try {
      expect(createStoreFromEnvironment({ BACKEND_STORE_PATH: `  ${path}  ` })).toBeInstanceOf(FileReplicaStore)
      expect(createStoreFromEnvironment({ BACKEND_STORE_PATH: "  " })).toBeInstanceOf(ReplicaStore)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
