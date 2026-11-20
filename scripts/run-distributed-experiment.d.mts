export type DistributedScenarioId =
  | 'normal-connectivity'
  | 'high-latency'
  | 'packet-loss'
  | 'short-disconnection'
  | 'long-partition'
  | 'reconnection'
  | 'concurrent-updates-during-partition'
  | 'partition-local-writes-reordered-duplicate-reconnect'

export const SUPPORTED_DISTRIBUTED_SCENARIOS: readonly DistributedScenarioId[]

export interface DistributedExperimentOverrides {
  configPath?: string
  replicaUrls?: string[]
  scenario?: DistributedScenarioId
  seed?: number
  operationsPerReplica?: number
  timeoutMs?: number
  latencyMs?: number
  dropEvery?: number
  outputPath?: string
  gitCommit?: string
  writeOutput?: boolean
}

export interface DistributedExperimentResult {
  schemaVersion: 2
  protocolVersion: string
  softwareVersion: string
  gitCommit: string
  runId: string
  seed: number
  replicaIds: string[]
  scenario: DistributedScenarioId
  configuration: {
    replicaCount: number
    operationsPerReplica: number
    timeoutMs: number
    latencyMs: number
    dropEvery: number
    operationDistribution: string
    faultSchedule: string[]
  }
  startedAt: string
  finishedAt: string
  experimentDurationMs: number
  convergenceTimeMs: number | null
  recoveryTimeMs: number | null
  operationsGenerated: number
  operationsTransmitted: number
  operationsApplied: number
  operationsDeduplicated: number
  operationsRejected: number
  simulatedPacketDrops: number
  stockOperationOutcomes: {
    applied: number
    duplicate: number
    noEffect: number
    rejected: number
  }
  applicationPayloadBytes: number
  bytesSent: number
  bytesReceived: number
  totalBytesExchanged: number
  logSizeBytesPerReplica: number[]
  bandwidthOverheadBytes: number
  persistentStorageBytes: number | null
  stateBytes: number
  stateHash: string
  metadataStateHashes: string[]
  metadataConverged: boolean
  semanticCorrect: boolean
  operationsCorrect: boolean
  withinTimeout: boolean
  finalCorrectness: boolean
  converged: boolean
}

export function runDistributedExperiment(
  overrides?: DistributedExperimentOverrides,
): Promise<DistributedExperimentResult>
