import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createStateMessage, encodeSyncMessage } from "../sync/protocol"
import { ReplicaSimulator } from "../sync/simulator"

export const GC_MATRIX_VERSION = "orset-gc-1"
export const GC_METRIC_SCHEMA_VERSION = "orset-gc-metrics-1"

export interface GcExperimentConfig {
  matrixVersion: typeof GC_MATRIX_VERSION
  metricSchemaVersion: typeof GC_METRIC_SCHEMA_VERSION
  scenarioIds: string[]
  seeds: number[]
  replicaCount?: number
  operationsPerReplica?: number
  rounds?: number
  deleteRatio?: number
  runPrefix?: string
}

export interface GcExperimentRecord {
  schemaVersion: 1
  matrixVersion: typeof GC_MATRIX_VERSION
  metricSchemaVersion: typeof GC_METRIC_SCHEMA_VERSION
  runId: string
  scenarioId: string
  seed: number
  garbageCollect: boolean
  replicaIds: string[]
  replicaCount: number
  operationsPerReplica: number
  rounds: number
  deleteRatio: number
  offlineReplica: string | null
  offlineRounds: number
  operationCount: number
  deleteCount: number
  tombstonesCollected: number
  encodedPayloadBytes: number
  metadataSizeBytes: number
  tombstoneSizeBytes: number
  addTagCount: number
  tombstoneCount: number
  removeVectorSize: number
  observedSourceCount: number
  virtualTimeMs: number | null
  converged: boolean
  deletedElementReappeared: boolean
  correctnessViolations: number
  failed: boolean
  error?: string
}

export interface GcExperimentSummary {
  schemaVersion: 1
  matrixVersion: typeof GC_MATRIX_VERSION
  metricSchemaVersion: typeof GC_METRIC_SCHEMA_VERSION
  groups: Array<{
    scenarioId: string
    garbageCollect: boolean
    runs: number
    convergedRuns: number
    failedRuns: number
    resurrectionRuns: number
    meanTombstoneSizeBytes: number | null
    meanMetadataSizeBytes: number | null
    meanTombstonesCollected: number | null
    meanEncodedPayloadBytes: number | null
  }>
}

class SeededRandom {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0
    return this.state / 0x100000000
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )

  return value
}

const utf8Bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(canonicalize(value))).byteLength

const mean = (values: number[]): number | null =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null

const replicaIdsFor = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `r${index + 1}`)

export const supportedGcScenarioIds = [
  "online-no-gc",
  "online-gc",
  "delayed-replica-no-gc",
  "delayed-replica-gc",
] as const

export type GcScenarioId = (typeof supportedGcScenarioIds)[number]

const scenarioSettings = (
  scenarioId: string,
): { garbageCollect: boolean; offlineRounds: number } => {
  switch (scenarioId) {
    case "online-no-gc":
      return { garbageCollect: false, offlineRounds: 0 }
    case "online-gc":
      return { garbageCollect: true, offlineRounds: 0 }
    case "delayed-replica-no-gc":
      return { garbageCollect: false, offlineRounds: 2 }
    case "delayed-replica-gc":
      return { garbageCollect: true, offlineRounds: 2 }
    default:
      throw new Error(`Unsupported GC scenario: ${scenarioId}`)
  }
}

const stabilize = (simulator: ReplicaSimulator<string>): number => {
  let encodedPayloadBytes = 0
  let messageSequence = 0

  const mesh = (): void => {
    const payloadByReplica = Object.fromEntries(
      simulator.membershipIds.map((from) => {
        const snapshot = simulator.report(0).snapshots[from]
        return [
          from,
          encodeSyncMessage(
            createStateMessage(
              from,
              `gc-measure-${from}-${++messageSequence}`,
              snapshot,
            ),
          ).byteLength,
        ]
      }),
    )

    const before = simulator.report(0).events.length
    simulator.fullMesh()
    for (const event of simulator.report(0).events.slice(before)) {
      if (event.type === "send" && event.replicaId)
        encodedPayloadBytes += payloadByReplica[event.replicaId] ?? 0
    }
    simulator.deliverAll()
  }

  mesh()
  mesh()
  return encodedPayloadBytes
}

export const runGcExperiment = (
  scenarioId: string,
  seed: number,
  options: {
    replicaCount: number
    operationsPerReplica: number
    rounds: number
    deleteRatio: number
    runPrefix?: string
  },
): GcExperimentRecord => {
  const settings = scenarioSettings(scenarioId)
  const replicaIds = replicaIdsFor(options.replicaCount)
  const offlineReplica =
    settings.offlineRounds > 0 ? replicaIds[replicaIds.length - 1] : null
  const runId = `${options.runPrefix ?? "gc"}-${scenarioId}-${seed}`
  const deleted = new Set<string>()
  const random = new SeededRandom(seed >>> 0)

  const simulator = new ReplicaSimulator<string>(seed, replicaIds)

  let operationCount = 0
  let deleteCount = 0
  let tombstonesCollected = 0
  let encodedPayloadBytes = 0

  try {
    if (
      !Number.isInteger(seed) ||
      options.operationsPerReplica < 1 ||
      options.rounds < 1 ||
      options.deleteRatio < 0 ||
      options.deleteRatio > 1
    )
      throw new Error("Invalid GC experiment configuration")

    for (let round = 0; round < options.rounds; round += 1) {
      const isolate =
        Boolean(offlineReplica) && round < settings.offlineRounds

      if (isolate && offlineReplica) simulator.partition(offlineReplica)

      for (const replicaId of replicaIds) {
        if (isolate && replicaId === offlineReplica) continue

        const live: string[] = []

        for (let index = 0; index < options.operationsPerReplica; index += 1) {
          const value = `v-${replicaId}-${round}-${index}`
          simulator.update(replicaId, (replica) => {
            replica.add(value)
          })
          live.push(value)
          operationCount += 1
        }

        const deleteTarget = Math.floor(live.length * options.deleteRatio)

        for (let index = 0; index < deleteTarget; index += 1) {
          const slot = Math.floor(random.next() * live.length)
          const value = live.splice(slot, 1)[0]
          if (!value) continue
          simulator.update(replicaId, (replica) => {
            replica.remove(value)
          })
          deleted.add(value)
          deleteCount += 1
          operationCount += 1
        }
      }

      encodedPayloadBytes += stabilize(simulator)

      if (settings.garbageCollect) {
        const collected = simulator.collectGarbage()
        tombstonesCollected += Object.values(collected).reduce(
          (sum, result) => sum + result.tombstonesCollected,
          0,
        )
      }

      if (isolate && offlineReplica) simulator.reconnect(offlineReplica)
    }

    encodedPayloadBytes += stabilize(simulator)

    if (settings.garbageCollect) {
      const collected = simulator.collectGarbage()
      tombstonesCollected += Object.values(collected).reduce(
        (sum, result) => sum + result.tombstonesCollected,
        0,
      )
      encodedPayloadBytes += stabilize(simulator)
    }

    const report = simulator.report(seed)
    const snapshots = Object.values(report.snapshots)
    const visible = snapshots.flatMap((snapshot) =>
      Object.entries(snapshot.set.adds)
        .filter(([value, tags]) => {
          const tombstones = snapshot.set.removes[value] ?? []
          const covered = new Set(
            tombstones.map((tag) => `${tag.replicaId}:${tag.counter}`),
          )
          return tags.some(
            (tag) => !covered.has(`${tag.replicaId}:${tag.counter}`),
          )
        })
        .map(([value]) => value),
    )

    const reappeared = visible.filter((value) => deleted.has(value))
    const metadata = snapshots.map((snapshot) => snapshot.set)
    const tombstoneSizeBytes = metadata.reduce(
      (sum, set) => sum + utf8Bytes(set.removes),
      0,
    )
    const metadataSizeBytes = metadata.reduce(
      (sum, set) =>
        sum +
        utf8Bytes({
          adds: set.adds,
          removes: set.removes,
          removeVector: set.removeVector,
          observedRemoveVectors: set.observedRemoveVectors,
        }),
      0,
    )
    const addTagCount = metadata.reduce(
      (sum, set) =>
        sum + Object.values(set.adds).reduce((total, tags) => total + tags.length, 0),
      0,
    )
    const tombstoneCount = metadata.reduce(
      (sum, set) =>
        sum +
        Object.values(set.removes).reduce((total, tags) => total + tags.length, 0),
      0,
    )

    return {
      schemaVersion: 1,
      matrixVersion: GC_MATRIX_VERSION,
      metricSchemaVersion: GC_METRIC_SCHEMA_VERSION,
      runId,
      scenarioId,
      seed,
      garbageCollect: settings.garbageCollect,
      replicaIds,
      replicaCount: replicaIds.length,
      operationsPerReplica: options.operationsPerReplica,
      rounds: options.rounds,
      deleteRatio: options.deleteRatio,
      offlineReplica,
      offlineRounds: settings.offlineRounds,
      operationCount,
      deleteCount,
      tombstonesCollected,
      encodedPayloadBytes,
      metadataSizeBytes,
      tombstoneSizeBytes,
      addTagCount,
      tombstoneCount,
      removeVectorSize: metadata.reduce(
        (sum, set) => sum + Object.keys(set.removeVector ?? {}).length,
        0,
      ),
      observedSourceCount: metadata.reduce(
        (sum, set) => sum + Object.keys(set.observedRemoveVectors ?? {}).length,
        0,
      ),
      virtualTimeMs: report.virtualTimeMs,
      converged: report.converged,
      deletedElementReappeared: reappeared.length > 0,
      correctnessViolations: reappeared.length,
      failed: false,
    }
  } catch (error) {
    return {
      schemaVersion: 1,
      matrixVersion: GC_MATRIX_VERSION,
      metricSchemaVersion: GC_METRIC_SCHEMA_VERSION,
      runId,
      scenarioId,
      seed,
      garbageCollect: settings.garbageCollect,
      replicaIds,
      replicaCount: replicaIds.length,
      operationsPerReplica: options.operationsPerReplica,
      rounds: options.rounds,
      deleteRatio: options.deleteRatio,
      offlineReplica,
      offlineRounds: settings.offlineRounds,
      operationCount,
      deleteCount,
      tombstonesCollected,
      encodedPayloadBytes,
      metadataSizeBytes: 0,
      tombstoneSizeBytes: 0,
      addTagCount: 0,
      tombstoneCount: 0,
      removeVectorSize: 0,
      observedSourceCount: 0,
      virtualTimeMs: null,
      converged: false,
      deletedElementReappeared: false,
      correctnessViolations: 0,
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const defaultGcExperimentConfig = (
  overrides: Partial<GcExperimentConfig> = {},
): GcExperimentConfig => ({
  matrixVersion: GC_MATRIX_VERSION,
  metricSchemaVersion: GC_METRIC_SCHEMA_VERSION,
  scenarioIds: [...supportedGcScenarioIds],
  seeds: [11, 23, 37, 101, 202],
  replicaCount: 4,
  operationsPerReplica: 24,
  rounds: 4,
  deleteRatio: 0.85,
  ...overrides,
})

export const runGcExperimentMatrix = (
  config: GcExperimentConfig,
): GcExperimentRecord[] => {
  if (!config.scenarioIds.length || !config.seeds.length)
    throw new Error("GC experiment matrix must contain scenarios and seeds")

  if (
    new Set(config.scenarioIds).size !== config.scenarioIds.length ||
    new Set(config.seeds).size !== config.seeds.length
  )
    throw new Error("GC experiment scenarios and seeds must be unique")

  const replicaCount = config.replicaCount ?? 4
  const operationsPerReplica = config.operationsPerReplica ?? 24
  const rounds = config.rounds ?? 4
  const deleteRatio = config.deleteRatio ?? 0.85

  return config.scenarioIds.flatMap((scenarioId) =>
    config.seeds.map((seed) =>
      runGcExperiment(scenarioId, seed, {
        replicaCount,
        operationsPerReplica,
        rounds,
        deleteRatio,
        runPrefix: config.runPrefix,
      }),
    ),
  )
}

export const summarizeGcExperiments = (
  records: GcExperimentRecord[],
): GcExperimentSummary => {
  const groups = new Map<string, GcExperimentRecord[]>()

  for (const record of records) {
    const key = `${record.scenarioId}:${record.garbageCollect}`
    const grouped = groups.get(key) ?? []
    grouped.push(record)
    groups.set(key, grouped)
  }

  return {
    schemaVersion: 1,
    matrixVersion: GC_MATRIX_VERSION,
    metricSchemaVersion: GC_METRIC_SCHEMA_VERSION,
    groups: [...groups.entries()].map(([, grouped]) => {
      const successful = grouped.filter((record) => !record.failed)
      return {
        scenarioId: grouped[0].scenarioId,
        garbageCollect: grouped[0].garbageCollect,
        runs: grouped.length,
        convergedRuns: grouped.filter((record) => record.converged).length,
        failedRuns: grouped.filter((record) => record.failed).length,
        resurrectionRuns: grouped.filter(
          (record) => record.deletedElementReappeared,
        ).length,
        meanTombstoneSizeBytes: mean(
          successful.map((record) => record.tombstoneSizeBytes),
        ),
        meanMetadataSizeBytes: mean(
          successful.map((record) => record.metadataSizeBytes),
        ),
        meanTombstonesCollected: mean(
          successful.map((record) => record.tombstonesCollected),
        ),
        meanEncodedPayloadBytes: mean(
          successful.map((record) => record.encodedPayloadBytes),
        ),
      }
    }),
  }
}

export const writeGcExperimentArtifacts = (
  directory: string,
  config: GcExperimentConfig,
  records: GcExperimentRecord[],
): void => {
  if (!directory.trim()) throw new Error("Research artifact directory is required")
  if (existsSync(join(directory, "manifest.json")))
    throw new Error(`Refusing to overwrite existing research artifacts: ${directory}`)

  mkdirSync(directory, { recursive: true })

  const write = (name: string, content: string): void => {
    const path = join(directory, name)
    if (existsSync(path))
      throw new Error(`Refusing to overwrite existing research artifact: ${path}`)
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" })
  }

  write("config.json", `${JSON.stringify(config, null, 2)}\n`)
  write(
    "raw.jsonl",
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  )
  write(
    "summary.json",
    `${JSON.stringify(summarizeGcExperiments(records), null, 2)}\n`,
  )
  write(
    "manifest.json",
    `${JSON.stringify(
      {
        artifactSchemaVersion: 1,
        matrixVersion: config.matrixVersion,
        metricSchemaVersion: config.metricSchemaVersion,
        recordCount: records.length,
        configurationHash: createHash("sha256")
          .update(JSON.stringify(canonicalize(config)))
          .digest("hex"),
        complete: true,
      },
      null,
      2,
    )}\n`,
  )
}
