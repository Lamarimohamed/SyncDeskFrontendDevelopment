import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createHash } from "node:crypto"

const configPath = process.env.EXPERIMENT_CONFIG
const fileConfig = configPath
  ? JSON.parse(await readFile(configPath, "utf8"))
  : {}
const urls = (fileConfig.replicaUrls?.join(",") ?? process.env.REPLICA_URLS ?? "http://127.0.0.1:8787")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean)
const outputPath = process.env.EXPERIMENT_OUTPUT ?? ".tmp/distributed-experiment.json"
const seed = Number.parseInt(String(fileConfig.seed ?? process.env.EXPERIMENT_SEED ?? "20261103"), 10)
const operationsPerReplica = fileConfig.operationsPerReplica ?? 1
const startedAt = Date.now()

if (!urls.length || !Number.isInteger(seed) || !Number.isInteger(operationsPerReplica) || operationsPerReplica < 1)
  throw new Error("Replica URLs, seed, and a positive operationsPerReplica are required")

const request = async (url, path, options = {}) => {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${url}${path}: ${body?.error?.message ?? response.status}`)
  return body
}

const product = (replicaIndex, operationIndex) => ({
  id: `experiment-product-${replicaIndex}-${operationIndex}`,
  name: `Experiment ${replicaIndex}-${operationIndex}`,
  nameAr: `تجربة ${replicaIndex}-${operationIndex}`,
  description: "Distributed experiment product",
  descriptionAr: "منتج تجربة موزعة",
  price: 100 + replicaIndex + operationIndex,
  categoryId: "experiment-category",
  availability: "available",
  stock: 10,
  lowStockThreshold: 2,
  updatedAt: seed + replicaIndex * 100 + operationIndex,
})

const operations = urls.flatMap((_, replicaIndex) =>
  Array.from({ length: operationsPerReplica }, (_, operationIndex) => ({
    operationId: `run-${seed}-replica-${replicaIndex}-operation-${operationIndex}`,
    kind: "product.upsert",
    product: product(replicaIndex, operationIndex),
  })),
)
const deletion = {
  operationId: `run-${seed}-delete-replica-0`,
  kind: "product.delete",
  productId: product(0, 0).id,
}
const workload = [...operations, deletion]
const reconnectSchedule = [...operations].reverse().concat(deletion)

for (const url of urls) await request(url, "/health")

// The first phase intentionally withholds fanout, representing an application-level
// partition while each independent backend accepts a local write.
for (let replicaIndex = 0; replicaIndex < urls.length; replicaIndex += 1) {
  const localOperations = operations.filter((_, index) =>
    Math.floor(index / operationsPerReplica) === replicaIndex
  )
  await request(urls[replicaIndex], "/v1/retail/operations", {
    method: "POST",
    body: JSON.stringify({ operations: localOperations }),
  })
}

let transmitted = 0
let applied = 0
let deduplicated = 0
for (const url of urls) {
  const response = await request(url, "/v1/retail/operations", {
    method: "POST",
    body: JSON.stringify({ operations: reconnectSchedule.concat(reconnectSchedule) }),
  })
  transmitted += workload.length * 2
  for (const result of response.results) {
    if (result.status === "applied") applied += 1
    if (result.status === "duplicate") deduplicated += 1
  }
}

const normalizeCatalog = (catalog) => ({
  categories: [...catalog.categories].sort((a, b) => a.id.localeCompare(b.id)),
  products: [...catalog.products].sort((a, b) => a.id.localeCompare(b.id)),
})
const states = await Promise.all(urls.map((url) => request(url, "/v1/retail/state")))
const catalogs = states.map(({ catalog, ...state }) => ({ catalog, replicaId: state.replicaId }))
const normalizedCatalogs = catalogs.map((entry) => normalizeCatalog(entry.catalog))
const canonical = JSON.stringify(normalizedCatalogs[0])
const converged = normalizedCatalogs.every((catalog) => JSON.stringify(catalog) === canonical)
const expectedProductIds = workload
  .filter((operation) => operation.kind === "product.upsert")
  .map((operation) => operation.product.id)
  .filter((id) => id !== deletion.productId)
  .sort()
const expectedAppliedOperationIds = workload.map((operation) => operation.operationId).sort()
const semanticCorrect = normalizedCatalogs.every((catalog) =>
  JSON.stringify(catalog.products.map(({ id }) => id).sort()) === JSON.stringify(expectedProductIds)
)
const appliedOperationIds = states.map((state) => [...state.appliedOperationIds].sort())
const operationsCorrect = appliedOperationIds.every((ids) =>
  JSON.stringify(ids) === JSON.stringify(expectedAppliedOperationIds)
)
const metadataStateHashes = states.map((state) =>
  createHash("sha256").update(JSON.stringify(state.snapshot)).digest("hex")
)
const metadataConverged = metadataStateHashes.every((hash) => hash === metadataStateHashes[0])
const finishedAt = Date.now()
const result = {
  schemaVersion: 1,
  runId: `distributed-${seed}-${startedAt}`,
  seed,
  replicaIds: catalogs.map((entry) => entry.replicaId),
  scenario: "partition-local-writes-reordered-duplicate-reconnect",
  configuration: {
    replicaCount: urls.length,
    operationsPerReplica,
    operationDistribution: "one partition-local batch per replica",
    faultSchedule: ["withhold fanout", "reverse-order replay", "duplicate replay", "delete replay"],
  },
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date(finishedAt).toISOString(),
  experimentDurationMs: finishedAt - startedAt,
  convergenceTimeMs: converged && semanticCorrect && operationsCorrect ? finishedAt - startedAt : null,
  recoveryTimeMs: converged ? finishedAt - startedAt : null,
  operationsGenerated: workload.length,
  operationsTransmitted: transmitted,
  operationsApplied: applied,
  operationsDeduplicated: deduplicated,
  applicationPayloadBytes: Buffer.byteLength(JSON.stringify({ operations: workload })),
  bandwidthOverheadBytes: null,
  persistentStorageBytes: null,
  stateBytes: normalizedCatalogs.reduce((total, catalog) => total + Buffer.byteLength(JSON.stringify(catalog)), 0),
  stateHash: createHash("sha256").update(canonical).digest("hex"),
  metadataStateHashes,
  metadataConverged,
  semanticCorrect,
  operationsCorrect,
  finalCorrectness: converged && semanticCorrect && operationsCorrect,
  converged: converged && semanticCorrect && operationsCorrect,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
process.stdout.write(`${JSON.stringify(result)}\n`)
if (!result.finalCorrectness) process.exitCode = 1
