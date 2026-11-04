import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createHash } from "node:crypto"

const urls = (process.env.REPLICA_URLS ?? "http://127.0.0.1:8787")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean)
const outputPath = process.env.EXPERIMENT_OUTPUT ?? ".tmp/distributed-experiment.json"
const seed = Number.parseInt(process.env.EXPERIMENT_SEED ?? "20261103", 10)
const startedAt = Date.now()

if (!urls.length || !Number.isInteger(seed)) throw new Error("REPLICA_URLS and EXPERIMENT_SEED are required")

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

const operations = urls.map((_, replicaIndex) => ({
  operationId: `run-${seed}-replica-${replicaIndex}`,
  kind: "product.upsert",
  product: product(replicaIndex, 0),
}))
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
for (let index = 0; index < urls.length; index += 1) {
  await request(urls[index], "/v1/retail/operations", {
    method: "POST",
    body: JSON.stringify({ operations: [workload[index]] }),
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
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date(finishedAt).toISOString(),
  convergenceTimeMs: converged ? finishedAt - startedAt : null,
  operationsGenerated: workload.length,
  operationsTransmitted: transmitted,
  operationsApplied: applied,
  operationsDeduplicated: deduplicated,
  applicationPayloadBytes: Buffer.byteLength(JSON.stringify({ operations: workload })),
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
if (!converged) process.exitCode = 1
