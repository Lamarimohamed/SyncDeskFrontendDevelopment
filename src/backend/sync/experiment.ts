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

  converged: boolean

  stateHashes: Record<string, string>

  stateSizes: Record<string, number>

  metadataSizes: Record<string, number>

  events: ReturnType<ReplicaSimulator<T>["report"]>["events"]

  failed: boolean

  error?: string
}

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

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

    const stateHashes = Object.fromEntries(
      replicaIds.map((id) => [id, hash(report.snapshots[id])]),
    )

    const stateSizes = Object.fromEntries(
      replicaIds.map((id) => [id, JSON.stringify(report.snapshots[id]).length]),
    )

    const metadataSizes = Object.fromEntries(
      replicaIds.map((id) => [
        id,

        report.snapshots[id].set.adds
          ? Object.values(report.snapshots[id].set.adds).flat().length +
            Object.values(report.snapshots[id].set.removes).flat().length
          : 0,
      ]),
    )

    return {
      scenarioId: config.scenarioId,

      seed: config.seed,

      replicaCount: replicaIds.length,

      operationCount,

      synchronizationCount,

      messageCount,

      encodedPayloadBytes,

      converged: report.converged,

      stateHashes,

      stateSizes,

      metadataSizes,

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

      converged: false,

      stateHashes: {},

      stateSizes: {},

      metadataSizes: {},

      events: simulator.report(config.seed).events,

      failed: true,

      error: error instanceof Error ? error.message : String(error),
    }
  }
}
