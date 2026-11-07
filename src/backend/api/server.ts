import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import { ReplicaRuntime, type ReplicaSnapshot } from "../crdt/replica"
import { FileReplicaStore, ReplicaStore, type ReplicaRecord } from "../persistence/ReplicaStore"
import { ReliableSyncEndpoint } from "../sync/reliability"
import { DurableOperationLog, type OperationLogState } from "../sync/operationLog"
import { VersionedRetailRuntime } from "../sync/versionedRetailRuntime"
import { validateVersionedRetailOperation, type VersionedRetailOperation } from "../../domain/retailSync"
import { loadRetailRuntime, RetailDomainRuntime, validateRetailOperation } from "./retail"
import { EscrowedStock, type EscrowedStockState } from "../../domain/stock"

const API_VERSION = "1"
const PROTOCOL_VERSION = "syncdesk-retail-v2"
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
  versionedOperationStage?: (
    stage: "beforeAppend" | "afterAppend" | "afterApply" | "beforeCheckpoint" | "afterCheckpoint",
    operation: VersionedRetailOperation,
  ) => void
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

interface VersionedRecoveryState {
  schemaVersion: 1
  status: "recovering" | "complete"
  logPosition: number
}

interface BackendBootstrapState {
  schemaVersion: 1
  protocolVersion: string
  status: "initialized"
  initializedAt: number
  registeredReplicaIds: string[]
  allocations: Record<string, Record<string, number>>
  stockStates: Record<string, EscrowedStockState>
}

const isVersionedRecoveryState = (value: unknown): value is VersionedRecoveryState =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  (value.status === "recovering" || value.status === "complete") &&
  typeof value.logPosition === "number" &&
  Number.isSafeInteger(value.logPosition) &&
  value.logPosition >= 0

const isBootstrapState = (value: unknown): value is BackendBootstrapState =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  value.protocolVersion === PROTOCOL_VERSION &&
  value.status === "initialized" &&
  typeof value.initializedAt === "number" &&
  Array.isArray(value.registeredReplicaIds) &&
  value.registeredReplicaIds.every((id) => typeof id === "string" && id.length > 0) &&
  isRecord(value.allocations) &&
  isRecord(value.stockStates)

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
  const replicaId = options.replicaId ?? process.env.BACKEND_REPLICA_ID ?? "backend-replica"
  if (!replicaId) throw new Error("Backend replica identity is required")

  const store = options.store ?? createStoreFromEnvironment()
  const bodyLimit = options.bodyLimitBytes ?? MAX_BODY_BYTES
  if (!Number.isInteger(bodyLimit) || bodyLimit <= 0)
    throw new Error("Request body limit must be a positive integer")

  let endpoint = loadEndpoint(replicaId, store)
  let retailRuntime = loadRetailRuntime(replicaId, store)
  const logRecordId = `${replicaId}:operation-log`
  const log = DurableOperationLog.load({
    load: (): OperationLogState | undefined => store.load(logRecordId)?.state as OperationLogState | undefined,
    save: (state) => { store.save(logRecordId, state) },
  })
  const bootstrapRecordId = `${replicaId}:bootstrap`
  const storedBootstrap = store.load(bootstrapRecordId)?.state
  let bootstrap: BackendBootstrapState
  if (storedBootstrap !== undefined) {
    if (!isBootstrapState(storedBootstrap))
      throw new Error(`Invalid backend bootstrap state for replica ${replicaId}`)
    bootstrap = structuredClone(storedBootstrap)
  } else {
    bootstrap = {
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      status: "initialized",
      initializedAt: Date.now(),
      registeredReplicaIds: [],
      allocations: {},
      stockStates: Object.fromEntries(
        retailRuntime.getCatalog().products.map((product) => [
          product.id,
          EscrowedStock.create(replicaId, product.stock, product.id).stateSnapshot(),
        ]),
      ),
    }
    try {
      store.save(bootstrapRecordId, bootstrap)
    } catch {
      // Existing callers may start the server before persistence is available.
      // The first successful bootstrap or operation persists this state.
    }
  }
  const versionedRuntime = new VersionedRetailRuntime(retailRuntime.getCatalog(), replicaId, bootstrap.stockStates)
  const persistBootstrap = (): void => {
    bootstrap.stockStates = versionedRuntime.stockStates()
    store.save(bootstrapRecordId, bootstrap)
  }
  const recoveryRecordId = `${replicaId}:versioned-recovery`
  const persistRecovery = (state: VersionedRecoveryState): void => {
    store.save(recoveryRecordId, state)
  }
  const logEntries = log.all()
  const previousRecovery = store.load(recoveryRecordId)?.state
  if (previousRecovery !== undefined && !isVersionedRecoveryState(previousRecovery))
    throw new Error(`Invalid versioned recovery state for replica ${replicaId}`)
  if (logEntries.length > 0 || (previousRecovery as VersionedRecoveryState | undefined)?.status === "recovering") {
    persistRecovery({ schemaVersion: 1, status: "recovering", logPosition: logEntries.at(-1)?.position ?? 0 })
    for (const entry of logEntries) versionedRuntime.apply(entry.operation)
    persistBootstrap()
    persistRecovery({ schemaVersion: 1, status: "complete", logPosition: logEntries.at(-1)?.position ?? 0 })
  }
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

  const persistRetail = (candidate: RetailDomainRuntime): ReplicaRecord => {
    try {
      return store.save(`${replicaId}:retail`, candidate.snapshot())
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

    if (method === "GET" && path === "/v1/bootstrap") {
      const catalog = versionedRuntime.catalog()
      json(response, 200, {
        apiVersion: API_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        backendReplicaId: replicaId,
        initialization: {
          status: bootstrap.status,
          catalogState: catalog.products.length === 0 && catalog.categories.length === 0 ? "empty" : "data",
          initializedAt: bootstrap.initializedAt,
          registeredReplicaCount: bootstrap.registeredReplicaIds.length,
        },
        catalog,
        stockStates: versionedRuntime.stockStates(),
      })
      return
    }

    if (method === "POST" && path === "/v1/bootstrap") {
      requestChain = requestChain
        .then(async () => {
          const body = await readJson(request, bodyLimit)
          if (!isRecord(body) || typeof body.replicaId !== "string" || body.replicaId.length === 0)
            throw new HttpError(400, "invalid_bootstrap_request", "A browser replicaId is required")
          const browserReplicaId = body.replicaId
          if (!bootstrap.registeredReplicaIds.includes(browserReplicaId))
            bootstrap.registeredReplicaIds.push(browserReplicaId)
          if (body.requestedRights !== undefined && !isRecord(body.requestedRights))
            throw new HttpError(400, "invalid_bootstrap_request", "requestedRights must be an object")
          if (isRecord(body.requestedRights) && !bootstrap.allocations[browserReplicaId]) {
            const granted: Record<string, number> = {}
            for (const [productId, requested] of Object.entries(body.requestedRights)) {
              if (typeof requested !== "number" || !Number.isSafeInteger(requested) || requested < 0)
                throw new HttpError(400, "invalid_bootstrap_request", "requestedRights values must be non-negative integers")
              const allocated = versionedRuntime.allocateRights(productId, browserReplicaId, requested)
              granted[productId] = allocated
            }
            bootstrap.allocations[browserReplicaId] = granted
          }
          persistBootstrap()
          const catalog = versionedRuntime.catalog()
          json(response, 200, {
            apiVersion: API_VERSION,
            protocolVersion: PROTOCOL_VERSION,
            backendReplicaId: replicaId,
            initialization: {
              status: bootstrap.status,
              catalogState: catalog.products.length === 0 && catalog.categories.length === 0 ? "empty" : "data",
              initializedAt: bootstrap.initializedAt,
              registeredReplicaCount: bootstrap.registeredReplicaIds.length,
            },
            catalog,
            stockStates: versionedRuntime.stockStates(),
            allocation: bootstrap.allocations[browserReplicaId] ?? {},
          })
        })
        .catch((error: unknown) => {
          if (error instanceof HttpError) errorResponse(response, error.status, error.code, error.message)
          else errorResponse(response, 400, "bootstrap_failed", "The backend bootstrap request failed")
        })
      return
    }

    if (method === "GET" && path === "/v1/retail/catalog") {
      const versionedCatalog = versionedRuntime.catalog()
      const versionedProductIds = new Set(versionedCatalog.products.map((product) => product.id))
      const versionedCategoryIds = new Set(versionedCatalog.categories.map((category) => category.id))
      const legacyCatalog = retailRuntime.getCatalog()
      json(response, 200, {
        catalog: {
          products: [
            ...legacyCatalog.products.filter((product) => !versionedProductIds.has(product.id)),
            ...versionedCatalog.products,
          ],
          categories: [
            ...legacyCatalog.categories.filter((category) => !versionedCategoryIds.has(category.id)),
            ...versionedCatalog.categories,
          ],
        },
        replicaId,
      })
      return
    }

    if (method === "GET" && path === "/v1/retail/state") {
      json(response, 200, {
        replicaId,
        ...retailRuntime.snapshot(),
      })
      return
    }

    if (method === "GET" && path === "/v1/sync/operations") {
      const query = new URL(request.url ?? "", `http://${request.headers.host ?? "localhost"}`).searchParams
      const cursor = Number(query.get("after") ?? "0")
      const limit = Number(query.get("limit") ?? "100")
      if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        errorResponse(response, 400, "invalid_cursor", "Cursor must be a non-negative integer and limit must be 1..500")
        return
      }

      json(response, 200, { ...log.after(cursor, limit), logSizeBytes: log.size() })
      return
    }

    if (method === "GET" && path === "/v1/sync/catalog") {
      json(response, 200, { replicaId, catalog: versionedRuntime.catalog(), appliedOperationIds: versionedRuntime.operationIds() })
      return
    }

    if (method === "POST" && path === "/v1/sync/operations") {
      requestChain = requestChain.then(async () => {
        const body = await readJson(request, bodyLimit)
        if (!isRecord(body) || !Array.isArray(body.operations) || body.operations.length === 0 || body.operations.length > 100) {
          throw new HttpError(400, "invalid_operations", "Operations must contain 1..100 entries")
        }
        const results = body.operations.map((value) => {
          const operation = validateVersionedRetailOperation(value)
          options.versionedOperationStage?.("beforeAppend", operation)
          versionedRuntime.validate(operation)
          const result = log.append(operation)
          if (result.status === "accepted") {
            options.versionedOperationStage?.("afterAppend", operation)
            persistRecovery({ schemaVersion: 1, status: "recovering", logPosition: result.position })
            versionedRuntime.apply(operation)
            persistBootstrap()
            persistBootstrap()
            options.versionedOperationStage?.("afterApply", operation)
            options.versionedOperationStage?.("beforeCheckpoint", operation)
            persistRecovery({ schemaVersion: 1, status: "complete", logPosition: result.position })
            options.versionedOperationStage?.("afterCheckpoint", operation)
          }
          return { operationId: operation.operationId, ...result, stockOutcome: versionedRuntime.stockOutcome(operation.operationId) }
        })
        json(response, 200, { results, accepted: results.filter((result) => result.status === "accepted").length, persisted: true })
      }).catch((error: unknown) => {
        if (error instanceof HttpError) errorResponse(response, error.status, error.code, error.message)
        else errorResponse(response, 400, "invalid_operation", error instanceof Error ? error.message : "The operation is invalid")
      })
      return
    }

    if (method === "POST" && path === "/v1/retail/operations") {
      requestChain = requestChain
        .then(async () => {
          const body = await readJson(request, bodyLimit)
          if (!isRecord(body) || !Array.isArray(body.operations) || body.operations.length === 0) {
            throw new HttpError(400, "invalid_retail_operations", "Retail operations must be a non-empty array")
          }
          if (body.operations.every((operation) => isRecord(operation) && operation.schemaVersion === 2)) {
            const results = body.operations.map((value) => {
              const operation = validateVersionedRetailOperation(value)
              options.versionedOperationStage?.("beforeAppend", operation)
              const result = log.append(operation)
              if (result.status === "accepted") {
                options.versionedOperationStage?.("afterAppend", operation)
                persistRecovery({ schemaVersion: 1, status: "recovering", logPosition: result.position })
                versionedRuntime.apply(operation)
                options.versionedOperationStage?.("afterApply", operation)
                options.versionedOperationStage?.("beforeCheckpoint", operation)
                persistRecovery({ schemaVersion: 1, status: "complete", logPosition: result.position })
                options.versionedOperationStage?.("afterCheckpoint", operation)
              }
              return { operationId: operation.operationId, ...result }
            })
            json(response, 200, {
              results,
              catalog: versionedRuntime.catalog(),
              persistedAt: Date.now(),
              sync: { cursor: log.after(0, 500).nextCursor, logSizeBytes: log.size() },
            })
            return
          }
          const candidate = new RetailDomainRuntime(
            ReplicaRuntime.fromJSON(retailRuntime.replica.snapshot()),
            retailRuntime.getCatalog(),
            retailRuntime.appliedIds(),
          )
          const results = body.operations.map((operation) => candidate.apply(validateRetailOperation(operation)))
          const record = persistRetail(candidate)
          retailRuntime = candidate
          json(response, 200, {
            results,
            catalog: candidate.getCatalog(),
            persistedAt: record.updatedAt,
          })
        })
        .catch((error: unknown) => {
          if (error instanceof HttpError) {
            errorResponse(response, error.status, error.code, error.message)
            return
          }
          if (error instanceof PersistenceError) {
            errorResponse(response, 503, PERSISTENCE_FAILURE_RESPONSE.code, PERSISTENCE_FAILURE_RESPONSE.message)
            return
          }
          errorResponse(response, 400, "invalid_retail_operation", "The retail operation is invalid")
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
