import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import { ReplicaRuntime, type ReplicaSnapshot } from "../crdt/replica"
import { FileReplicaStore, ReplicaStore, type ReplicaRecord } from "../persistence/ReplicaStore"
import { ReliableSyncEndpoint } from "../sync/reliability"

const API_VERSION = "1"
const MAX_BODY_BYTES = 1024 * 1024

export interface ReplicaStoreLike {
  load(replicaId: string): ReplicaRecord | undefined
  save(replicaId: string, state: unknown): ReplicaRecord
}

export interface BackendServerOptions {
  host?: string
  port?: number
  replicaId?: string
  store?: ReplicaStoreLike
  bodyLimitBytes?: number
  corsOrigin?: string
}

export interface BackendServer {
  server: Server
  host: string
  port: number
  replicaId: string
  close(): Promise<void>
}

export const PERSISTENCE_FAILURE_RESPONSE = {
  code: "persistence_failed",
  message: "The synchronization update could not be persisted.",
} as const

interface PersistedReplica {
  snapshot: ReplicaSnapshot<string>
  appliedMessageIds: string[]
}

interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
  const encoded = JSON.stringify(body)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
  })
  response.end(encoded)
}

const corsHeaders = (response: ServerResponse, origin: string): void => {
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
}

const errorResponse = (
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void => {
  json(response, status, { error: { code, message } } satisfies ErrorResponse)
}

const readJson = async (
  request: IncomingMessage,
  limit: number,
): Promise<unknown> => {
  let size = 0
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > limit) throw new HttpError(413, "request_too_large", "Request body exceeds the size limit")
    chunks.push(buffer)
  }

  if (size === 0) throw new HttpError(400, "invalid_json", "Request body must contain JSON")

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must contain valid JSON")
  }
}

class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const persistedState = (value: unknown): value is PersistedReplica =>
  isRecord(value) &&
  isRecord(value.snapshot) &&
  Array.isArray(value.appliedMessageIds) &&
  value.appliedMessageIds.every((id) => typeof id === "string" && id.length > 0)

const parsePort = (value: number | undefined): number => {
  const port = value ?? 8787
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Backend port must be an integer between 0 and 65535")
  return port
}

const loadEndpoint = (
  replicaId: string,
  store: ReplicaStoreLike,
): ReliableSyncEndpoint<string> => {
  const saved = store.load(replicaId)
  if (!saved) return new ReliableSyncEndpoint(new ReplicaRuntime<string>(replicaId))

  if (!persistedState(saved.state))
    throw new Error(`Invalid persisted state for replica ${replicaId}`)

  const endpoint = new ReliableSyncEndpoint(
    ReplicaRuntime.fromJSON(saved.state.snapshot),
  )
  endpoint.restoreAppliedMessageIds(saved.state.appliedMessageIds)
  return endpoint
}

export const createStoreFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): ReplicaStoreLike => {
  const path = environment.BACKEND_STORE_PATH?.trim()
  return path ? new FileReplicaStore(path) : new ReplicaStore()
}

class PersistenceError extends Error {}

export const createBackendServer = (
  options: BackendServerOptions = {},
): BackendServer => {
  const replicaId = options.replicaId ?? "backend-replica"
  if (!replicaId) throw new Error("Backend replica identity is required")

  const store = options.store ?? createStoreFromEnvironment()
  const bodyLimit = options.bodyLimitBytes ?? MAX_BODY_BYTES
  if (!Number.isInteger(bodyLimit) || bodyLimit <= 0)
    throw new Error("Request body limit must be a positive integer")

  let endpoint = loadEndpoint(replicaId, store)
  let requestChain = Promise.resolve()
  const corsOrigin = options.corsOrigin ?? process.env.BACKEND_CORS_ORIGIN ?? '*'

  const persist = (candidate: ReliableSyncEndpoint<string>): ReplicaRecord => {
    try {
      return store.save(replicaId, {
        snapshot: candidate.replica.snapshot(),
        appliedMessageIds: candidate.appliedMessageIdSnapshot(),
      } satisfies PersistedReplica)
    } catch {
      throw new PersistenceError()
    }
  }

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const method = request.method ?? "GET"
    const path = (request.url ?? "").split("?", 1)[0]
    corsHeaders(response, corsOrigin)

    if (method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (method === "GET" && path === "/health") {
      json(response, 200, { status: "ok", apiVersion: API_VERSION })
      return
    }

    if (method === "GET" && path === "/v1/replica") {
      const record = store.load(replicaId)
      json(response, 200, {
        replicaId,
        snapshot: endpoint.replica.snapshot(),
        persisted: Boolean(record),
        updatedAt: record?.updatedAt ?? null,
      })
      return
    }

    if (method === "POST" && path === "/v1/sync/messages") {
      requestChain = requestChain
        .then(async () => {
          const message = await readJson(request, bodyLimit)
          const candidate = new ReliableSyncEndpoint(
            ReplicaRuntime.fromJSON(endpoint.replica.snapshot()),
          )
          candidate.restoreAppliedMessageIds(endpoint.appliedMessageIdSnapshot())
          const result = candidate.receive(message)
          const record = persist(candidate)
          endpoint = candidate
          json(response, 200, {
            applied: result.applied,
            acknowledgement: result.acknowledgement,
            replicaId,
            snapshot: result.replica.snapshot(),
            persistedAt: record.updatedAt,
          })
        })
        .catch((error: unknown) => {
          if (error instanceof HttpError) {
            errorResponse(response, error.status, error.code, error.message)
            return
          }
          if (error instanceof PersistenceError) {
            errorResponse(
              response,
              503,
              PERSISTENCE_FAILURE_RESPONSE.code,
              PERSISTENCE_FAILURE_RESPONSE.message,
            )
            return
          }
          if (error instanceof Error) {
            errorResponse(response, 400, "invalid_sync_message", "The synchronization message is invalid")
            return
          }
          errorResponse(response, 500, "internal_error", "The request could not be processed")
        })
      return
    }

    errorResponse(response, 404, "not_found", "The requested endpoint does not exist")
  }

  const server = createServer(handler)
  const host = options.host ?? process.env.BACKEND_HOST ?? "127.0.0.1"
  const port = parsePort(options.port ?? (process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : undefined))

  return {
    server,
    host,
    port,
    replicaId,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export const startBackendServer = async (
  options: BackendServerOptions = {},
): Promise<BackendServer> => {
  const backend = createBackendServer(options)
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      backend.server.off("listening", onListening)
      reject(error)
    }
    const onListening = (): void => {
      backend.server.off("error", onError)
      resolve()
    }
    backend.server.once("error", onError)
    backend.server.once("listening", onListening)
    backend.server.listen(backend.port, backend.host)
  })

  const address = backend.server.address()
  if (!address || typeof address === "string")
    throw new Error("Backend server did not expose a TCP address")
  backend.port = address.port
  return backend
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const backend = await startBackendServer()
  const address = backend.server.address()
  process.stdout.write(`SyncDesk backend listening on http://${backend.host}:${typeof address === "object" && address ? address.port : backend.port}\n`)
  const shutdown = (): void => {
    void backend.close().then(() => process.exit(0))
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

export const createFileBackedStore = (path: string): FileReplicaStore =>
  new FileReplicaStore(path)
