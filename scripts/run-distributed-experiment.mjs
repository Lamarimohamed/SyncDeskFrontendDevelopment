import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createHash } from "node:crypto"

export const SUPPORTED_DISTRIBUTED_SCENARIOS = [
  "normal-connectivity",
  "high-latency",
  "packet-loss",
  "short-disconnection",
  "long-partition",
  "reconnection",
  "concurrent-updates-during-partition",
  "partition-local-writes-reordered-duplicate-reconnect",
]

const SCENARIO_PROFILES = {
  "normal-connectivity": {
    latencyMs: 0,
    dropEvery: 0,
    partitionPhases: 0,
    reverseReconnectOrder: false,
    duplicateReplay: false,
    concurrentConflict: false,
    faultSchedule: ["normal-fanout"],
  },
  "high-latency": {
    latencyMs: 25,
    dropEvery: 0,
    partitionPhases: 0,
    reverseReconnectOrder: false,
    duplicateReplay: false,
    concurrentConflict: true,
    faultSchedule: ["simulated-link-latency-25ms", "concurrent-field-updates"],
  },
  "packet-loss": {
    latencyMs: 5,
    dropEvery: 2,
    partitionPhases: 0,
    reverseReconnectOrder: false,
    duplicateReplay: true,
    concurrentConflict: true,
    faultSchedule: ["drop-every-2nd-attempt", "retry-retransmission", "duplicate-delivery"],
  },
  "short-disconnection": {
    latencyMs: 5,
    dropEvery: 0,
    partitionPhases: 1,
    reverseReconnectOrder: false,
    duplicateReplay: false,
    concurrentConflict: false,
    faultSchedule: ["short-offline-window", "reconnect-replay"],
  },
  "long-partition": {
    latencyMs: 10,
    dropEvery: 0,
    partitionPhases: 2,
    reverseReconnectOrder: true,
    duplicateReplay: true,
    concurrentConflict: true,
    faultSchedule: ["extended-partition", "multi-op-local-queue", "reverse-order-reconnect"],
  },
  "reconnection": {
    latencyMs: 5,
    dropEvery: 0,
    partitionPhases: 1,
    reverseReconnectOrder: true,
    duplicateReplay: true,
    concurrentConflict: false,
    faultSchedule: ["withhold-fanout", "reordered-reconnect", "idempotent-duplicate-verify"],
  },
  "concurrent-updates-during-partition": {
    latencyMs: 5,
    dropEvery: 0,
    partitionPhases: 1,
    reverseReconnectOrder: true,
    duplicateReplay: true,
    concurrentConflict: true,
    faultSchedule: ["partition-all-replicas", "concurrent-same-and-different-field-patches", "escrowed-stock-ops", "reconnect-merge"],
  },
  "partition-local-writes-reordered-duplicate-reconnect": {
    latencyMs: 0,
    dropEvery: 0,
    partitionPhases: 1,
    reverseReconnectOrder: true,
    duplicateReplay: true,
    concurrentConflict: true,
    faultSchedule: ["withhold fanout", "reverse-order replay", "duplicate replay", "delete replay"],
  },
}

const delay = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve())

export const runDistributedExperiment = async (overrides = {}) => {
  const configPath = overrides.configPath ?? process.env.EXPERIMENT_CONFIG
  const fileConfig = configPath ? JSON.parse(await readFile(configPath, "utf8")) : {}
  const urls = (
    overrides.replicaUrls ??
    fileConfig.replicaUrls ??
    (process.env.REPLICA_URLS ?? "http://127.0.0.1:8787").split(",")
  )
    .map((url) => String(url).trim().replace(/\/+$/, ""))
    .filter(Boolean)

  const scenario =
    overrides.scenario ??
    fileConfig.scenario ??
    process.env.EXPERIMENT_SCENARIO ??
    "partition-local-writes-reordered-duplicate-reconnect"

  if (!SUPPORTED_DISTRIBUTED_SCENARIOS.includes(scenario)) {
    throw new Error(`Unsupported distributed experiment scenario: ${scenario}`)
  }

  const profile = SCENARIO_PROFILES[scenario]
  const seed = Number.parseInt(
    String(overrides.seed ?? fileConfig.seed ?? process.env.EXPERIMENT_SEED ?? "20261103"),
    10,
  )
  const operationsPerReplica =
    overrides.operationsPerReplica ?? fileConfig.operationsPerReplica ?? 1
  const timeoutMs = Number.parseInt(
    String(overrides.timeoutMs ?? fileConfig.timeoutMs ?? process.env.EXPERIMENT_TIMEOUT_MS ?? "15000"),
    10,
  )
  const latencyMs = overrides.latencyMs ?? fileConfig.latencyMs ?? profile.latencyMs
  const dropEvery = overrides.dropEvery ?? fileConfig.dropEvery ?? profile.dropEvery
  const softwareVersion = JSON.parse(await readFile("package.json", "utf8")).version
  const gitCommit = overrides.gitCommit ?? process.env.GIT_COMMIT ?? "unknown"
  const startedAt = Date.now()

  if (
    !urls.length ||
    !Number.isInteger(seed) ||
    !Number.isInteger(operationsPerReplica) ||
    operationsPerReplica < 1 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error("Replica URLs, seed, positive operationsPerReplica, and positive timeoutMs are required")
  }

  let bytesSent = 0
  let bytesReceived = 0
  let simulatedDrops = 0
  let transmissionAttemptCounter = 0

  const checkTimeout = () => {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Experiment exceeded convergence timeout of ${timeoutMs}ms`)
    }
  }

  const request = async (url, path, options = {}, simulateFaults = false) => {
    checkTimeout()
    if (simulateFaults && latencyMs > 0) {
      await delay(latencyMs)
    }
    const bodyString = typeof options.body === "string" ? options.body : undefined
    const requestBytes = bodyString ? Buffer.byteLength(bodyString, "utf8") : 0

    if (simulateFaults && dropEvery > 0) {
      transmissionAttemptCounter += 1
      if (transmissionAttemptCounter % dropEvery === 0) {
        simulatedDrops += 1
        bytesSent += requestBytes
        // Retransmit after simulated packet loss
        if (latencyMs > 0) await delay(latencyMs)
      }
    }

    bytesSent += requestBytes
    const response = await fetch(`${url}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    })
    const rawText = await response.text()
    bytesReceived += Buffer.byteLength(rawText, "utf8")
    const body = JSON.parse(rawText)
    if (!response.ok) throw new Error(`${url}${path}: ${body?.error?.message ?? response.status}`)
    return body
  }

  const replicaTag = (replicaIndex) => `exp-replica-${replicaIndex}`

  const buildCategoryOp = (replicaIndex) => {
    const operationId = `run-${seed}-cat-replica-${replicaIndex}`
    const replicaId = replicaTag(replicaIndex)
    return {
      schemaVersion: 2,
      operationId,
      replicaId,
      version: { logicalTime: 1, replicaId, operationId },
      kind: "category.patch",
      categoryId: "experiment-category",
      changes: {
        name: "Experiment Category",
        nameAr: "فئة التجربة",
        description: `Category initialized by ${replicaId}`,
      },
    }
  }

  const buildProductObj = (replicaIndex, operationIndex) => ({
    id: `experiment-product-${replicaIndex}-${operationIndex}`,
    name: `Experiment ${replicaIndex}-${operationIndex}`,
    nameAr: `تجربة ${replicaIndex}-${operationIndex}`,
    description: "Distributed experiment product",
    descriptionAr: "منتج تجربة موزعة",
    price: 100 + replicaIndex * 10 + operationIndex,
    categoryId: "experiment-category",
    availability: "available",
    stock: 4,
    lowStockThreshold: 2,
    updatedAt: seed + replicaIndex * 100 + operationIndex,
  })

  const restoreOps = urls.flatMap((_, replicaIndex) =>
    Array.from({ length: operationsPerReplica }, (__, operationIndex) => {
      const prod = buildProductObj(replicaIndex, operationIndex)
      const operationId = `run-${seed}-restore-r${replicaIndex}-op${operationIndex}`
      const replicaId = replicaTag(replicaIndex)
      return {
        schemaVersion: 2,
        operationId,
        replicaId,
        version: { logicalTime: 2 + operationIndex, replicaId, operationId },
        kind: "product.restore",
        productId: prod.id,
        product: prod,
      }
    }),
  )

  const sharedTargetId = buildProductObj(0, 0).id
  const concurrentOps = profile.concurrentConflict
    ? urls.flatMap((_, replicaIndex) => {
        const replicaId = replicaTag(replicaIndex)
        const priceOpId = `run-${seed}-conflict-price-r${replicaIndex}`
        const fieldOpId = `run-${seed}-concurrent-field-r${replicaIndex}`
        const ops = [
          {
            schemaVersion: 2,
            operationId: priceOpId,
            replicaId,
            // Equal logicalTime forces deterministic UTF-8 replicaId tie-breaking
            version: { logicalTime: 20, replicaId, operationId: priceOpId },
            kind: "product.patch",
            productId: sharedTargetId,
            changes: { price: 200 + replicaIndex * 25 },
          },
        ]
        if (replicaIndex === 0) {
          ops.push({
            schemaVersion: 2,
            operationId: fieldOpId,
            replicaId,
            version: { logicalTime: 21, replicaId, operationId: fieldOpId },
            kind: "product.patch",
            productId: sharedTargetId,
            changes: { name: `Converged Shared Product (${seed})` },
          })
        } else if (replicaIndex === 1) {
          ops.push({
            schemaVersion: 2,
            operationId: fieldOpId,
            replicaId,
            version: { logicalTime: 21, replicaId, operationId: fieldOpId },
            kind: "product.patch",
            productId: sharedTargetId,
            changes: { description: "Concurrent different-field update preserved" },
          })
        }
        return ops
      })
    : []

  const stockRestockOp = {
    schemaVersion: 2,
    operationId: `run-${seed}-stock-restock-r0`,
    replicaId: replicaTag(0),
    version: { logicalTime: 30, replicaId: replicaTag(0), operationId: `run-${seed}-stock-restock-r0` },
    kind: "inventory.restock",
    productId: sharedTargetId,
    tokenIds: [`run-${seed}-tok-0`, `run-${seed}-tok-1`],
  }

  const stockDecrementOp = {
    schemaVersion: 2,
    operationId: `run-${seed}-stock-decrement-r0`,
    replicaId: replicaTag(0),
    version: { logicalTime: 31, replicaId: replicaTag(0), operationId: `run-${seed}-stock-decrement-r0` },
    kind: "inventory.decrement",
    productId: sharedTargetId,
    tokenIds: [`run-${seed}-tok-0`],
  }

  // Delete the last product of the last replica (or second operation if single replica with >1 op)
  const deleteTargetId =
    urls.length > 1
      ? buildProductObj(urls.length - 1, 0).id
      : operationsPerReplica > 1
        ? buildProductObj(0, operationsPerReplica - 1).id
        : null

  const deletionOps = deleteTargetId
    ? [
        {
          schemaVersion: 2,
          operationId: `run-${seed}-delete-${deleteTargetId}`,
          replicaId: replicaTag(0),
          version: { logicalTime: 40, replicaId: replicaTag(0), operationId: `run-${seed}-delete-${deleteTargetId}` },
          kind: "product.delete",
          productId: deleteTargetId,
        },
      ]
    : []

  const categoryOp = buildCategoryOp(0)
  const perReplicaLocalOps = urls.map((_, replicaIndex) => {
    const replicaId = replicaTag(replicaIndex)
    const owned = [
      ...(replicaIndex === 0 ? [categoryOp] : []),
      ...restoreOps.filter((op) => op.replicaId === replicaId),
      ...concurrentOps.filter((op) => op.replicaId === replicaId),
      ...(replicaIndex === 0 ? [stockRestockOp, stockDecrementOp] : []),
    ]
    return owned
  })

  const workload = [
    categoryOp,
    ...restoreOps,
    ...concurrentOps,
    stockRestockOp,
    stockDecrementOp,
    ...deletionOps,
  ]

  // Verify health and bootstrap on all target servers
  for (let i = 0; i < urls.length; i += 1) {
    await request(urls[i], "/health")
    await request(urls[i], "/v1/bootstrap", {
      method: "POST",
      body: JSON.stringify({ replicaId: replicaTag(i) }),
    })
  }

  let transmitted = 0
  let accepted = 0
  let deduplicated = 0
  let rejected = 0
  const stockOutcomes = []

  const recordResults = (results) => {
    for (const res of results) {
      if (res.status === "accepted") accepted += 1
      else if (res.status === "duplicate") deduplicated += 1
      else rejected += 1
      if (res.stockOutcome) stockOutcomes.push(res.stockOutcome)
    }
  }

  // Phase 1: Partition-local writes (each replica receives its own local operations first)
  for (let replicaIndex = 0; replicaIndex < urls.length; replicaIndex += 1) {
    const localBatch = perReplicaLocalOps[replicaIndex]
    if (localBatch.length > 0) {
      const response = await request(
        urls[replicaIndex],
        "/v1/sync/operations",
        {
          method: "POST",
          body: JSON.stringify({ operations: localBatch }),
        },
        true,
      )
      transmitted += localBatch.length
      recordResults(response.results)
    }
  }

  // Phase 2: Reconnection / Anti-entropy exchange across all replicas
  const OrderedBase = [... restoreOps, ...concurrentOps, stockRestockOp, stockDecrementOp]
  const orderedOps = profile.reverseReconnectOrder
    ? [categoryOp, ...OrderedBase.reverse(), ...deletionOps]
    : [categoryOp, ...OrderedBase, ...deletionOps]

  const reconnectPayload = profile.duplicateReplay
    ? orderedOps.concat(orderedOps)
    : orderedOps

  for (const url of urls) {
    // Push in chunks of at most 100 operations to respect the v2 batch limit
    for (let offset = 0; offset < reconnectPayload.length; offset += 100) {
      const chunk = reconnectPayload.slice(offset, offset + 100)
      const response = await request(
        url,
        "/v1/sync/operations",
        {
          method: "POST",
          body: JSON.stringify({ operations: chunk }),
        },
        true,
      )
      transmitted += chunk.length
      recordResults(response.results)
    }
  }

  // Phase 3: Pull operation logs & verify catalog + metadata convergence
  const syncStates = await Promise.all(urls.map((url) => request(url, "/v1/sync/catalog", {}, true)))
  const logPages = await Promise.all(
    urls.map((url) => request(url, "/v1/sync/operations?after=0&limit=500", {}, true)),
  )

  const normalizeCatalog = (catalog) => ({
    categories: [...catalog.categories].sort((a, b) => a.id.localeCompare(b.id)),
    products: [...catalog.products].sort((a, b) => a.id.localeCompare(b.id)),
  })

  const normalizedCatalogs = syncStates.map((state) => normalizeCatalog(state.catalog))
  const canonical = JSON.stringify(normalizedCatalogs[0])
  const converged = normalizedCatalogs.every((catalog) => JSON.stringify(catalog) === canonical)

  const expectedProductIds = restoreOps
    .map((operation) => operation.productId)
    .filter((id) => id !== deleteTargetId)
    .sort()
  const expectedAppliedOperationIds = workload.map((operation) => operation.operationId).sort()

  const semanticCorrect = normalizedCatalogs.every((catalog) => {
    const idsMatch =
      JSON.stringify(catalog.products.map(({ id }) => id).sort()) === JSON.stringify(expectedProductIds)
    const sharedProd = catalog.products.find((p) => p.id === sharedTargetId)
    const expectedWinningPrice = profile.concurrentConflict
      ? 200 + (urls.length - 1) * 25
      : buildProductObj(0, 0).price
    const priceMatches = !sharedProd || sharedProd.price === expectedWinningPrice
    return idsMatch && priceMatches
  })

  const appliedOperationIds = syncStates.map((state) => [...state.appliedOperationIds].sort())
  const operationsCorrect = appliedOperationIds.every(
    (ids) => JSON.stringify(ids) === JSON.stringify(expectedAppliedOperationIds),
  )

  const metadataStateHashes = appliedOperationIds.map((ids) =>
    createHash("sha256").update(JSON.stringify(ids)).digest("hex"),
  )
  const metadataConverged = metadataStateHashes.every((hash) => hash === metadataStateHashes[0])

  const finishedAt = Date.now()
  const durationMs = finishedAt - startedAt
  const withinTimeout = durationMs <= timeoutMs
  const finalCorrectness = converged && semanticCorrect && operationsCorrect && withinTimeout && rejected === 0

  const result = {
    schemaVersion: 2,
    protocolVersion: "syncdesk-retail-v2",
    softwareVersion,
    gitCommit,
    runId: `distributed-${scenario}-${seed}-${startedAt}`,
    seed,
    replicaIds: syncStates.map((entry) => entry.replicaId),
    scenario,
    configuration: {
      replicaCount: urls.length,
      operationsPerReplica,
      timeoutMs,
      latencyMs,
      dropEvery,
      operationDistribution: "one partition-local v2 batch per replica followed by reconnect sync",
      faultSchedule: profile.faultSchedule,
    },
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    experimentDurationMs: durationMs,
    convergenceTimeMs: finalCorrectness ? durationMs : null,
    recoveryTimeMs: null,
    operationsGenerated: workload.length,
    operationsTransmitted: transmitted,
    operationsApplied: accepted,
    operationsDeduplicated: deduplicated,
    operationsRejected: rejected,
    simulatedPacketDrops: simulatedDrops,
    stockOperationOutcomes: {
      applied: stockOutcomes.filter((o) => o.status === "applied").length,
      duplicate: stockOutcomes.filter((o) => o.status === "duplicate").length,
      noEffect: stockOutcomes.filter((o) => o.status === "no-effect").length,
      rejected: stockOutcomes.filter((o) => o.status === "rejected").length,
    },
    applicationPayloadBytes: Buffer.byteLength(JSON.stringify({ operations: workload }), "utf8"),
    bytesSent,
    bytesReceived,
    totalBytesExchanged: bytesSent + bytesReceived,
    logSizeBytesPerReplica: logPages.map((p) => p.logSizeBytes),
    bandwidthOverheadBytes: bytesSent + bytesReceived - Buffer.byteLength(JSON.stringify({ operations: workload }), "utf8"),
    persistentStorageBytes: null,
    stateBytes: normalizedCatalogs.reduce(
      (total, catalog) => total + Buffer.byteLength(JSON.stringify(catalog), "utf8"),
      0,
    ),
    stateHash: createHash("sha256").update(canonical).digest("hex"),
    metadataStateHashes,
    metadataConverged,
    semanticCorrect,
    operationsCorrect,
    withinTimeout,
    finalCorrectness,
    converged: finalCorrectness,
  }

  const outputPath = overrides.outputPath ?? process.env.EXPERIMENT_OUTPUT ?? ".tmp/distributed-experiment.json"
  if (overrides.writeOutput !== false) {
    await mkdir(dirname(outputPath), { recursive: true })
    let resultPath = outputPath
    try {
      await access(resultPath)
      resultPath = `${outputPath}.${result.runId}.json`
    } catch {
      // The configured output path is available.
    }
    await writeFile(resultPath, `${JSON.stringify({ ...result, resultPath }, null, 2)}\n`, "utf8")
  }

  return result
}

const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))

if (isMainModule) {
  try {
    const result = await runDistributedExperiment()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (!result.finalCorrectness) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
