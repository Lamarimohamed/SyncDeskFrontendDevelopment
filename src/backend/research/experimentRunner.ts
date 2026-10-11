import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { dirname } from "node:path"

import {
  runExperiment,
  type ExperimentConfig,
  type ExperimentResult,
} from "../sync/experiment"
import { runComparableScenario } from "../baseline/comparison"

export interface MatrixScenario {
  scenarioId: string

  replicaIds: string[]

  operationsPerReplica: number

  dropEvery?: number

  notes: string
}

export interface ExperimentMatrixConfig {
  scenarios: MatrixScenario[]

  seeds: number[]

  outputPath?: string

  runPrefix?: string
}

export interface RawExperimentRecord {
  schemaVersion: 1

  runId: string

  system: "crdt" | "client-server-lww"

  scenarioId: string

  seed: number

  configuration: MatrixScenario

  operationCount: number

  appliedOperations: number | null

  bufferedOperations: number | null

  rejectedOperations: number | null

  conflictedOperations: number | null

  lostOperations: number | null

  converged: boolean

  convergenceTimeMs: number | null

  encodedApplicationPayloadBytes: number | null

  acknowledgementBytes: number | null

  retryBytes: number | null

  totalApplicationSynchronizationBytes: number | null

  stateSizeBytes: number | null

  metadataSizeBytes: number | null

  tombstoneSizeBytes: number | null

  stateHashes: Record<string, string>

  failed: boolean

  failureClass?: "configuration" | "runtime"

  error?: string
}

export interface SummaryMetric {
  sampleCount: number

  median: number | null

  interquartileRange: number | null

  mean: number | null

  standardDeviation: number | null
}

export interface ExperimentSummary {
  schemaVersion: 1

  generatedFrom: string

  groups: Array<{
    scenarioId: string

    system: string

    runs: number

    convergedRuns: number

    failedRuns: number

    metrics: {
      operationCount: SummaryMetric

      payloadBytes: SummaryMetric

      synchronizationBytes: SummaryMetric
    }
  }>
}

export const defaultScenarioMatrix: MatrixScenario[] = [
  {
    scenarioId: "stable-connectivity",
    replicaIds: ["a", "b", "c"],
    operationsPerReplica: 2,
    notes: "No loss; deterministic delayed full-state exchange.",
  },

  {
    scenarioId: "short-partitions",
    replicaIds: ["a", "b", "c"],
    operationsPerReplica: 2,
    notes: "Short partition is represented by a dropped message schedule.",
  },

  {
    scenarioId: "long-partition-concurrent",
    replicaIds: ["a", "b", "c", "d"],
    operationsPerReplica: 3,
    dropEvery: 2,
    notes: "Concurrent updates with periodic message loss.",
  },

  {
    scenarioId: "offline-reconnect",
    replicaIds: ["a", "b", "c"],
    operationsPerReplica: 2,
    notes:
      "Offline-write semantics are compared separately with the authoritative baseline.",
  },

  {
    scenarioId: "duplicate-reordered",
    replicaIds: ["a", "b", "c"],
    operationsPerReplica: 2,
    notes:
      "Deterministic delay and ordering; duplicate support is validated by endpoint tests.",
  },
]

const percentile = (values: number[], rank: number): number | null => {
  if (!values.length) return null

  const index = (values.length - 1) * rank

  const lower = Math.floor(index)

  const upper = Math.ceil(index)

  if (lower === upper) return values[lower]

  return values[lower] + (values[upper] - values[lower]) * (index - lower)
}

export const summarize = (
  records: RawExperimentRecord[],
): ExperimentSummary => {
  const groups = new Map<string, RawExperimentRecord[]>()

  for (const record of records) {
    const key = `${record.scenarioId}:${record.system}`

    groups.set(key, [...(groups.get(key) ?? []), record])
  }

  const metric = (
    grouped: RawExperimentRecord[],
    selector: (record: RawExperimentRecord) => number | null,
  ): SummaryMetric => {
    const values = grouped
      .map(selector)
      .filter(
        (value): value is number => value !== null && Number.isFinite(value),
      )
      .sort((a, b) => a - b)

    if (!values.length)
      return {
        sampleCount: 0,
        median: null,
        interquartileRange: null,
        mean: null,
        standardDeviation: null,
      }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length

    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      values.length

    return {
      sampleCount: values.length,

      median: percentile(values, 0.5),

      interquartileRange:
        (percentile(values, 0.75) ?? 0) - (percentile(values, 0.25) ?? 0),

      mean,

      standardDeviation: Math.sqrt(variance),
    }
  }

  return {
    schemaVersion: 1 as const,

    generatedFrom: "raw JSONL records",

    groups: [...groups.entries()].map(([key, grouped]) => {
      const [scenarioId, system] = key.split(":")

      return {
        scenarioId,

        system,

        runs: grouped.length,

        convergedRuns: grouped.filter((record) => record.converged).length,

        failedRuns: grouped.filter((record) => record.failed).length,

        metrics: {
          operationCount: metric(grouped, (record) => record.operationCount),

          payloadBytes: metric(
            grouped,
            (record) => record.encodedApplicationPayloadBytes,
          ),

          synchronizationBytes: metric(
            grouped,
            (record) => record.totalApplicationSynchronizationBytes,
          ),
        },
      }
    }),
  }
}

const toRecord = (
  runId: string,
  configuration: MatrixScenario,
  seed: number,
  result: ExperimentResult<string>,
): RawExperimentRecord => {
  const stateSizeBytes = Object.values(result.stateSizes).reduce(
    (sum, size) => sum + size,
    0,
  )

  const metadataSizeBytes = Object.values(result.metadataSizes).reduce(
    (sum, size) => sum + size,
    0,
  )

  const tombstoneSizeBytes = Object.values(result.tombstoneSizes).reduce(
    (sum, size) => sum + size,
    0,
  )

  return {
    schemaVersion: 1,

    runId,

    system: "crdt",

    scenarioId: configuration.scenarioId,

    seed,

    configuration,

    operationCount: result.operationCount,

    appliedOperations: result.failed ? null : result.operationCount,

    bufferedOperations: null,

    rejectedOperations: null,

    conflictedOperations: null,

    lostOperations: configuration.dropEvery
      ? Math.floor(result.messageCount / configuration.dropEvery)
      : 0,

    converged: result.converged,

    convergenceTimeMs: result.converged ? result.virtualTimeMs : null,

    encodedApplicationPayloadBytes: result.encodedPayloadBytes,

    acknowledgementBytes: result.acknowledgementBytes,

    retryBytes: result.retryPayloadBytes,

    totalApplicationSynchronizationBytes:
      result.encodedPayloadBytes +
      result.acknowledgementBytes +
      result.retryPayloadBytes,

    stateSizeBytes,

    metadataSizeBytes,

    tombstoneSizeBytes,

    stateHashes: result.stateHashes,

    failed: result.failed,

    failureClass: result.failed ? "runtime" : undefined,

    error: result.error,
  }
}

export const runMatrix = (
  config: ExperimentMatrixConfig,
): RawExperimentRecord[] => {
  if (!config.scenarios.length || !config.seeds.length)
    throw new Error("Experiment matrix must contain scenarios and seeds")
  if (
    new Set(config.scenarios.map((scenario) => scenario.scenarioId)).size !==
      config.scenarios.length ||
    new Set(config.seeds).size !== config.seeds.length
  )
    throw new Error("Experiment scenarios and seeds must be unique")

  const prefix = config.runPrefix ?? "run"

  return config.scenarios.flatMap((scenario) =>
    config.seeds.map((seed) => {
      const runId = `${prefix}-${scenario.scenarioId}-${seed}`

      return toRecord(
        runId,
        scenario,
        seed,
        runExperiment<string>({ ...scenario, seed }),
      )
    }),
  )
}

export const runComparisonMatrix = (
  config: ExperimentMatrixConfig,
): RawExperimentRecord[] => {
  const crdtRecords = runMatrix(config)
  const baselineRecords = config.scenarios.flatMap((scenario) =>
    config.seeds.map((seed) => {
      const comparison = runComparableScenario({
        scenarioId: scenario.scenarioId,
        seed,
        replicaIds: scenario.replicaIds,
        operationsPerReplica: scenario.operationsPerReplica,
        disconnectedReplica:
          scenario.scenarioId === "offline-reconnect"
            ? scenario.replicaIds[scenario.replicaIds.length - 1]
            : undefined,
      })
      return {
        schemaVersion: 1 as const,
        runId: `${config.runPrefix ?? "run"}-${scenario.scenarioId}-${seed}-baseline`,
        system: "client-server-lww" as const,
        scenarioId: scenario.scenarioId,
        seed,
        configuration: scenario,
        operationCount: comparison.operationCount,
        appliedOperations: comparison.baseline.submitted,
        bufferedOperations: comparison.baseline.buffered,
        rejectedOperations: 0,
        conflictedOperations: comparison.baseline.conflicts,
        lostOperations: 0,
        converged: comparison.baseline.authoritative,
        convergenceTimeMs: 0,
        encodedApplicationPayloadBytes: null,
        acknowledgementBytes: null,
        retryBytes: null,
        totalApplicationSynchronizationBytes: null,
        stateSizeBytes: null,
        metadataSizeBytes: null,
        tombstoneSizeBytes: null,
        stateHashes: { server: comparison.baseline.stateHash },
        failed: false,
      }
    }),
  )
  return [...crdtRecords, ...baselineRecords]
}

export const writeJsonl = (
  path: string,
  records: RawExperimentRecord[],
  overwrite = false,
): void => {
  if (existsSync(path) && !overwrite)
    throw new Error(`Refusing to overwrite existing research data: ${path}`)

  mkdirSync(dirname(path), { recursive: true })

  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  )
}

export const readJsonl = (path: string): RawExperimentRecord[] =>
  readFileSync(path, "utf8")

    .split(/\r?\n/)

    .filter(Boolean)

    .map((line) => JSON.parse(line) as RawExperimentRecord)

export const writeSummary = (
  path: string,
  summary: ExperimentSummary,
  overwrite = false,
): void => {
  if (existsSync(path) && !overwrite)
    throw new Error(`Refusing to overwrite existing research summary: ${path}`)

  mkdirSync(dirname(path), { recursive: true })

  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
}
