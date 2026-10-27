import { createHash } from "node:crypto"

import { ReplicaSimulator } from "./simulator"

import { createStateMessage, encodeSyncMessage } from "./protocol"

export interface ExperimentConfig {
  scenarioId: string

  seed: number

  replicaIds?: string[]

  operationsPerReplica?: number

  dropEvery?: number
}

export interface ExperimentResult<T extends string> {
  scenarioId: string

  seed: number

  replicaCount: number

  operationCount: number

  synchronizationCount: number

  messageCount: number

  encodedPayloadBytes: number

  acknowledgementBytes: number

  retryPayloadBytes: number

  virtualTimeMs: number | null

  converged: boolean

  stateHashes: Record<string, string>

  stateSizes: Record<string, number>

  metadataSizes: Record<string, number>

  tombstoneSizes: Record<string, number>

  events: ReturnType<ReplicaSimulator<T>["report"]>["events"]

  failed: boolean

  error?: string
}

const hash = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")

const utf8Bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(canonicalize(value))).byteLength

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  return value
}

export const runExperiment = <T extends string,>(
  config: ExperimentConfig,
): ExperimentResult<T> => {
  const replicaIds = config.replicaIds ?? ["r1", "r2", "r3", "r4"]

  const operationsPerReplica = config.operationsPerReplica ?? 2
  const simulator = new ReplicaSimulator<T>(config.seed, replicaIds)

  let operationCount = 0

  let synchronizationCount = 0

  let messageCount = 0

  let encodedPayloadBytes = 0

  try {
    if (
      !config.scenarioId ||
      !Number.isInteger(config.seed) ||
      operationsPerReplica < 0
    )
      throw new Error("Invalid experiment configuration")
    for (const replicaId of replicaIds) {
      for (let index = 0; index < operationsPerReplica; index += 1) {
        simulator.update(replicaId, (replica) => {
          replica.add(`value-${replicaId}-${index}` as T)

          replica.incrementCounter(1)
        })

        operationCount += 1
      }
    }

    for (const from of replicaIds) {
      for (const target of replicaIds) {
        if (from === target) continue

        const snapshot = simulator.report(config.seed).snapshots[from]

        const message = createStateMessage(
          from,
          `experiment-${from}-${target}`,
          snapshot,
        )

        encodedPayloadBytes += encodeSyncMessage(message).byteLength

        messageCount += 1

        synchronizationCount += 1

        simulator.send(from, target, {
          drop: config.dropEvery
            ? messageCount % config.dropEvery === 0
            : false,

          duplicate: false,

          delay: (messageCount + config.seed) % 3,
        })
      }
    }

    simulator.deliverAll()

    const report = simulator.report(config.seed)

    // Hashes compare the replicated semantic state; OR-Set observation
    // matrices and add-counter watermarks are per-replica bookkeeping.
    const semanticSet = (set: (typeof report.snapshots)[string]["set"]) => ({
      adds: set.adds,
      removes: set.removes,
      removeVector: set.removeVector,
    })

    const stateHashes = Object.fromEntries(
      replicaIds.map((id) => [
        id,
        hash({
          register: report.snapshots[id].register,
          set: semanticSet(report.snapshots[id].set),
          counter: report.snapshots[id].counter,
        }),
      ]),
    )

    const stateSizes = Object.fromEntries(
      replicaIds.map((id) => [id, utf8Bytes(report.snapshots[id])]),
    )

    const metadataSizes = Object.fromEntries(
      replicaIds.map((id) => [
        id,
        utf8Bytes({
          adds: report.snapshots[id].set.adds,
          removes: report.snapshots[id].set.removes,
        }),
      ]),
    )

    const tombstoneSizes = Object.fromEntries(
      replicaIds.map((id) => [id, utf8Bytes(report.snapshots[id].set.removes)]),
    )

    return {
      scenarioId: config.scenarioId,

      seed: config.seed,

      replicaCount: replicaIds.length,

      operationCount,

      synchronizationCount,

      messageCount,

      encodedPayloadBytes,

      acknowledgementBytes: 0,

      retryPayloadBytes: 0,

      virtualTimeMs: report.virtualTimeMs,

      converged: report.converged,

      stateHashes,

      stateSizes,

      metadataSizes,

      tombstoneSizes,

      events: report.events,

      failed: false,
    }
  } catch (error) {
    return {
      scenarioId: config.scenarioId,

      seed: config.seed,

      replicaCount: replicaIds.length,

      operationCount,

      synchronizationCount,

      messageCount,

      encodedPayloadBytes,

      acknowledgementBytes: 0,

      retryPayloadBytes: 0,

      virtualTimeMs: null,

      converged: false,

      stateHashes: {},

      stateSizes: {},

      metadataSizes: {},

      tombstoneSizes: {},

      events: simulator.report(config.seed).events,

      failed: true,

      error: error instanceof Error ? error.message : String(error),
    }
  }
}
