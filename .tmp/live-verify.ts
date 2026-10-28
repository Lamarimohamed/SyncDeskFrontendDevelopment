import { createStateMessage } from "../src/backend/sync/protocol"
import { ReplicaRuntime } from "../src/backend/crdt/replica"

const base = "http://127.0.0.1:8787"

const request = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json()
  return { status: response.status, json }
}

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

const health = await request("GET", "/health")
assert(health.status === 200 && health.json.status === "ok", `health failed: ${JSON.stringify(health)}`)

const category = await request("POST", "/v1/retail/operations", {
  operations: [
    {
      operationId: "live-cat-1",
      kind: "category.upsert",
      category: {
        id: "cat-live",
        name: "Live Demo",
        nameAr: "عرض مباشر",
        description: "Verification category",
        updatedAt: 1,
      },
    },
    {
      operationId: "live-prod-1",
      kind: "product.upsert",
      product: {
        id: "prod-live",
        name: "Live Product",
        nameAr: "منتج مباشر",
        description: "Verification product",
        descriptionAr: "منتج للتحقق",
        price: 1500,
        categoryId: "cat-live",
        availability: "available",
        stock: 7,
        lowStockThreshold: 2,
        updatedAt: 1,
      },
    },
  ],
})
assert(category.status === 200, `retail upsert failed: ${JSON.stringify(category)}`)
assert(
  Array.isArray(category.json.catalog?.products) && category.json.catalog.products[0]?.id === "prod-live",
  `retail catalog missing product: ${JSON.stringify(category.json)}`,
)

const runId = `live-${Date.now()}`
const offline = new ReplicaRuntime<string>(`store-offline-${runId}`)
offline.add("sku-offline")
offline.incrementCounter()
const firstSync = await request(
  "POST",
  "/v1/sync/messages",
  createStateMessage(offline.replicaId, `${runId}-1`, offline.snapshot()),
)
assert(firstSync.status === 200 && firstSync.json.applied === true, `first sync failed: ${JSON.stringify(firstSync)}`)

offline.remove("sku-offline")
const secondSync = await request(
  "POST",
  "/v1/sync/messages",
  createStateMessage(offline.replicaId, `${runId}-2`, offline.snapshot()),
)
assert(secondSync.status === 200 && secondSync.json.applied === true, `second sync failed: ${JSON.stringify(secondSync)}`)

const replica = await request("GET", "/v1/replica")
const restored = ReplicaRuntime.fromJSON<string>(replica.json.snapshot)
assert(!restored.set.has("sku-offline"), `deleted element visible after merge: ${JSON.stringify(replica.json.snapshot?.set)}`)
assert(
  replica.json.snapshot?.set?.removes?.["sku-offline"]?.length > 0,
  `tombstone missing after offline delete: ${JSON.stringify(replica.json.snapshot?.set)}`,
)

const duplicate = await request(
  "POST",
  "/v1/sync/messages",
  createStateMessage(offline.replicaId, `${runId}-1`, offline.snapshot()),
)
assert(duplicate.json.applied === false && duplicate.json.acknowledgement?.status === "duplicate", "duplicate not detected")

process.stdout.write("live API verification passed\n")
