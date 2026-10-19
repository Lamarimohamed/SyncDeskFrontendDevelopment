import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Category, Product } from '../../domain/types'
import {
  RetailReplicaSimulator,
  type RetailReplicaId,
  type RetailSimulationOperation,
  type RetailSimulationReport,
  type RetailSimulationState,
} from './retailSimulator'

export const RETAIL_MATRIX_VERSION = 'retail-5e-1'
export const RETAIL_METRIC_SCHEMA_VERSION = 'retail-metrics-2'

export type RetailExperimentModel = 'baseline' | 'candidate'

export interface RetailInitialState {
  products: Product[]
  categories: Category[]
}

export type RetailScheduleAction =
  | { type: 'local'; replicaId: RetailReplicaId; operationId: string }
  | {
      type: 'queue'
      operationId: string
      from: RetailReplicaId
      target: RetailReplicaId
      duplicate?: boolean
      delay?: number
    }
  | { type: 'partition' | 'reconnect'; replicaId: RetailReplicaId }
  | { type: 'deliver-all' | 'deliver-next' }

export interface RetailExperimentScenario {
  scenarioId: string
  description: string
  initialState: RetailInitialState
  operations: RetailSimulationOperation[]
  schedule: RetailScheduleAction[]
}

export interface RetailExperimentConfig {
  matrixVersion: typeof RETAIL_MATRIX_VERSION
  metricSchemaVersion: typeof RETAIL_METRIC_SCHEMA_VERSION
  scenarioIds: string[]
  seeds: number[]
  runPrefix?: string
}

export interface RetailExperimentRecord {
  schemaVersion: 1
  matrixVersion: typeof RETAIL_MATRIX_VERSION
  metricSchemaVersion: typeof RETAIL_METRIC_SCHEMA_VERSION
  runId: string
  scenarioId: string
  seed: number
  model: RetailExperimentModel
  replicaIds: RetailReplicaId[]
  initialStateHash: string
  workloadHash: string
  operationCount: number
  scheduledDeliveryAttempts: number | null
  blockedDeliveryAttempts: number | null
  successfulDeliveryCount: number | null
  duplicateDeliveryCount: number | null
  uniqueOperationsApplied: number | null
  serializedOperationPayloadBytes: number | null
  finalStateHash: string | null
  finalStateBytes: number | null
  metadataCounts: Record<RetailReplicaId, number> | null
  converged: boolean
  failed: boolean
  failureClass: 'configuration' | 'runtime' | undefined
  error: string | undefined
  scenario: RetailExperimentScenario
}

export interface RetailExperimentSummary {
  schemaVersion: 1
  matrixVersion: typeof RETAIL_MATRIX_VERSION
  metricSchemaVersion: typeof RETAIL_METRIC_SCHEMA_VERSION
  groups: Array<{
    scenarioId: string
    model: RetailExperimentModel
    runs: number
    convergedRuns: number
    failedRuns: number
    nonConvergedRuns: number
    finalStateHashAgreement: boolean | null
  }>
}

const REPLICAS: RetailReplicaId[] = ['A', 'B', 'C']

const clone = <T>(value: T): T => structuredClone(value)

const compareUtf8 = (left: string, right: string): number => {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index]
  }
  return leftBytes.length - rightBytes.length
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

export const canonicalSerialize = (value: unknown): string => JSON.stringify(canonicalize(value))

export const sha256 = (value: unknown): string =>
  createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex')

const stateForHash = (state: RetailSimulationState): unknown => ({
  products: [...state.products].sort((left, right) => compareUtf8(left.id, right.id)),
  categories: [...state.categories].sort((left, right) => compareUtf8(left.id, right.id)),
  inventoryDeltas: state.inventoryDeltas,
})

const bytes = (value: unknown): number => new TextEncoder().encode(canonicalSerialize(value)).byteLength

const product = (): Product => ({
  id: 'p1',
  name: 'Tea',
  nameAr: 'شاي',
  description: 'Green tea',
  descriptionAr: 'شاي أخضر',
  price: 10,
  categoryId: 'c1',
  availability: 'available',
  stock: 10,
  lowStockThreshold: 2,
  updatedAt: 1767225600000,
})

const category = (): Category => ({
  id: 'c1',
  name: 'Drinks',
  nameAr: 'مشروبات',
  description: 'Beverages',
  updatedAt: 1767225600000,
})

const version = (operationId: string, replicaId: RetailReplicaId, logicalTime: number) => ({
  operationId,
  replicaId,
  logicalTime,
})

type RetailOperationDetails =
  | Omit<Extract<RetailSimulationOperation, { kind: 'product.field.update' }>, 'operationId' | 'origin'>
  | Omit<Extract<RetailSimulationOperation, { kind: 'product.delete' }>, 'operationId' | 'origin'>
  | Omit<Extract<RetailSimulationOperation, { kind: 'product.restore' }>, 'operationId' | 'origin'>
  | Omit<Extract<RetailSimulationOperation, { kind: 'inventory.adjust' }>, 'operationId' | 'origin'>
  | Omit<Extract<RetailSimulationOperation, { kind: 'category.update' }>, 'operationId' | 'origin'>
  | Omit<Extract<RetailSimulationOperation, { kind: 'category.field.update' }>, 'operationId' | 'origin'>

const scenarioOperation = (
  operationId: string,
  origin: RetailReplicaId,
  operation: RetailOperationDetails,
): RetailSimulationOperation => ({
  operationId,
  origin,
  ...operation,
})

const withVersion = (
  operation: RetailSimulationOperation,
  logicalTime: number,
): RetailSimulationOperation => ({
  ...operation,
  version: version(operation.operationId, operation.origin, logicalTime),
})

const queueTo = (
  operationId: string,
  from: RetailReplicaId,
  targets: RetailReplicaId[],
  options: Pick<Extract<RetailScheduleAction, { type: 'queue' }>, 'duplicate' | 'delay'> = {},
): RetailScheduleAction[] =>
  targets.map((target) => ({ type: 'queue', operationId, from, target, ...options }))

const scenario = (
  scenarioId: string,
  description: string,
  operations: RetailSimulationOperation[],
  schedule: RetailScheduleAction[],
): RetailExperimentScenario => ({
  scenarioId,
  description,
  initialState: { products: [product()], categories: [category()] },
  operations,
  schedule,
})

const buildScenario = (scenarioId: string, seed: number): RetailExperimentScenario => {
  const sameField = [
    withVersion(
      scenarioOperation('a-name', 'A', {
        kind: 'product.field.update',
        productId: 'p1',
        field: 'name',
        value: 'Coffee',
      }),
      10,
    ),
    withVersion(
      scenarioOperation('b-name', 'B', {
        kind: 'product.field.update',
        productId: 'p1',
        field: 'name',
        value: 'Espresso',
      }),
      10,
    ),
  ]
  const deliveryOrder = seed % 2 === 0 ? ['a-name', 'b-name'] : ['b-name', 'a-name']

  switch (scenarioId) {
    case 'no-conflict':
    case 'different-field':
      return scenario(
        scenarioId,
        'Independent product fields edited on different replicas.',
        [
          withVersion(
            scenarioOperation('a-name', 'A', {
              kind: 'product.field.update',
              productId: 'p1',
              field: 'name',
              value: 'Coffee',
            }),
            10,
          ),
          withVersion(
            scenarioOperation('b-price', 'B', {
              kind: 'product.field.update',
              productId: 'p1',
              field: 'price',
              value: 12,
            }),
            10,
          ),
        ],
        [
          { type: 'local', replicaId: 'A', operationId: 'a-name' },
          { type: 'local', replicaId: 'B', operationId: 'b-price' },
          ...queueTo('a-name', 'A', ['B', 'C']),
          ...queueTo('b-price', 'B', ['A', 'C']),
          { type: 'deliver-all' },
        ],
      )
    case 'same-field':
      return scenario(
        scenarioId,
        'Concurrent same-field updates with deterministic version tie-breaking.',
        sameField,
        [
          { type: 'local', replicaId: 'A', operationId: 'a-name' },
          { type: 'local', replicaId: 'B', operationId: 'b-name' },
          ...deliveryOrder.flatMap((operationId) => {
            const from = operationId.startsWith('a') ? 'A' : 'B'
            return queueTo(operationId, from, ['A', 'B', 'C'])
          }),
          { type: 'deliver-all' },
        ],
      )
    case 'delete-update':
      return scenario(
        scenarioId,
        'Concurrent product deletion and field update.',
        [
          withVersion(
            scenarioOperation('a-delete', 'A', { kind: 'product.delete', productId: 'p1' }),
            10,
          ),
          withVersion(
            scenarioOperation('b-update', 'B', {
              kind: 'product.field.update',
              productId: 'p1',
              field: 'price',
              value: 15,
            }),
            10,
          ),
        ],
        [
          { type: 'local', replicaId: 'A', operationId: 'a-delete' },
          { type: 'local', replicaId: 'B', operationId: 'b-update' },
          ...queueTo('a-delete', 'A', ['B', 'C']),
          ...queueTo('b-update', 'B', ['A', 'C']),
          { type: 'deliver-all' },
        ],
      )
    case 'delete-restore':
      return scenario(
        scenarioId,
        'Explicit product deletion followed by a newer restoration.',
        [
          withVersion(
            scenarioOperation('a-delete', 'A', { kind: 'product.delete', productId: 'p1' }),
            10,
          ),
          withVersion(
            scenarioOperation('b-restore', 'B', {
              kind: 'product.restore',
              product: { ...product(), name: 'Restored tea' },
            }),
            20,
          ),
        ],
        [
          { type: 'local', replicaId: 'A', operationId: 'a-delete' },
          { type: 'local', replicaId: 'B', operationId: 'b-restore' },
          ...queueTo('b-restore', 'B', ['A', 'C']),
          ...queueTo('a-delete', 'A', ['B', 'C'], { delay: 1 }),
          { type: 'deliver-all' },
        ],
      )
    case 'duplicate-reordered':
      return scenario(
        scenarioId,
        'Duplicated and delayed deliveries are replayed in a deterministic order.',
        sameField,
        [
          { type: 'local', replicaId: 'A', operationId: 'a-name' },
          { type: 'local', replicaId: 'B', operationId: 'b-name' },
          { type: 'queue', operationId: 'b-name', from: 'B', target: 'C', duplicate: true, delay: 2 },
          { type: 'queue', operationId: 'a-name', from: 'A', target: 'C', delay: 1 },
          ...queueTo('a-name', 'A', ['B']),
          ...queueTo('b-name', 'B', ['A']),
          { type: 'deliver-all' },
        ],
      )
    case 'partition-reconnect':
      return scenario(
        scenarioId,
        'Three replicas edit independently during a partition, then reconnect.',
        [
          withVersion(
            scenarioOperation('a-name', 'A', {
              kind: 'product.field.update',
              productId: 'p1',
              field: 'name',
              value: 'Coffee',
            }),
            10,
          ),
          withVersion(
            scenarioOperation('b-price', 'B', {
              kind: 'product.field.update',
              productId: 'p1',
              field: 'price',
              value: 12,
            }),
            10,
          ),
          withVersion(
            scenarioOperation('c-availability', 'C', {
              kind: 'product.field.update',
              productId: 'p1',
              field: 'availability',
              value: 'unavailable',
            }),
            10,
          ),
        ],
        [
          { type: 'partition', replicaId: 'B' },
          { type: 'partition', replicaId: 'C' },
          { type: 'local', replicaId: 'A', operationId: 'a-name' },
          { type: 'local', replicaId: 'B', operationId: 'b-price' },
          { type: 'local', replicaId: 'C', operationId: 'c-availability' },
          ...queueTo('a-name', 'A', ['B', 'C']),
          ...queueTo('b-price', 'B', ['A', 'C']),
          ...queueTo('c-availability', 'C', ['A', 'B']),
          { type: 'deliver-all' },
          { type: 'reconnect', replicaId: 'B' },
          { type: 'reconnect', replicaId: 'C' },
          { type: 'deliver-all' },
        ],
      )
    case 'category-conflict':
      return scenario(
        scenarioId,
        'Concurrent category field updates.',
        [
          withVersion(
            scenarioOperation('a-category', 'A', {
              kind: 'category.update',
              category: { ...category(), name: 'Hot drinks' },
            }),
            10,
          ),
          withVersion(
            scenarioOperation('b-category', 'B', {
              kind: 'category.update',
              category: { ...category(), description: 'Warm beverages' },
            }),
            10,
          ),
        ],
        [
          { type: 'local', replicaId: 'A', operationId: 'a-category' },
          { type: 'local', replicaId: 'B', operationId: 'b-category' },
          ...queueTo('a-category', 'A', ['B', 'C']),
          ...queueTo('b-category', 'B', ['A', 'C']),
          { type: 'deliver-all' },
        ],
      )
    case 'inventory-exploratory':
      return scenario(
        scenarioId,
        'Additive inventory deltas; overselling remains a separate business property.',
        [
          withVersion(
            scenarioOperation('a-restock', 'A', { kind: 'inventory.adjust', productId: 'p1', delta: 2 }),
            10,
          ),
          withVersion(
            scenarioOperation('b-sale', 'B', { kind: 'inventory.adjust', productId: 'p1', delta: -3 }),
            10,
          ),
        ],
        [
          { type: 'local', replicaId: 'A', operationId: 'a-restock' },
          { type: 'local', replicaId: 'B', operationId: 'b-sale' },
          ...queueTo('a-restock', 'A', ['B', 'C']),
          ...queueTo('b-sale', 'B', ['A', 'C']),
          { type: 'deliver-all' },
        ],
      )
    default:
      throw new Error(`Unknown retail scenario: ${scenarioId}`)
  }
}

export const supportedRetailScenarioIds = [
  'no-conflict',
  'different-field',
  'same-field',
  'delete-update',
  'delete-restore',
  'duplicate-reordered',
  'partition-reconnect',
  'category-conflict',
  'inventory-exploratory',
] as const

const validateConfig = (config: RetailExperimentConfig): void => {
  if (config.matrixVersion !== RETAIL_MATRIX_VERSION) throw new Error('Unsupported retail matrix version')
  if (config.metricSchemaVersion !== RETAIL_METRIC_SCHEMA_VERSION) throw new Error('Unsupported retail metric schema version')
  if (!config.scenarioIds.length || !config.seeds.length) throw new Error('Retail experiment matrix must contain scenarios and seeds')
  if (new Set(config.scenarioIds).size !== config.scenarioIds.length) throw new Error('Retail scenario IDs must be unique')
  if (new Set(config.seeds).size !== config.seeds.length) throw new Error('Retail seeds must be unique')
  if (config.seeds.some((seed) => !Number.isSafeInteger(seed))) throw new Error('Retail seeds must be safe integers')
}

const execute = (scenario: RetailExperimentScenario, model: RetailExperimentModel): RetailSimulationReport => {
  const simulator = new RetailReplicaSimulator(clone(scenario.initialState), model)
  const operations = new Map(scenario.operations.map((operation) => [operation.operationId, operation]))
  for (const action of scenario.schedule) {
    if (action.type === 'local') {
      const operation = operations.get(action.operationId)
      if (!operation) throw new Error(`Schedule references unknown operation ${action.operationId}`)
      simulator.local(action.replicaId, clone(operation))
    } else if (action.type === 'queue') {
      simulator.queue(action.operationId, action.from, action.target, {
        duplicate: action.duplicate,
        delay: action.delay,
      })
    } else if (action.type === 'partition') {
      simulator.partition(action.replicaId)
    } else if (action.type === 'reconnect') {
      simulator.reconnect(action.replicaId)
    } else if (action.type === 'deliver-all') {
      simulator.deliverAll()
    } else {
      simulator.deliverNext()
    }
  }
  return simulator.report()
}

const failedRecord = (
  runId: string,
  scenario: RetailExperimentScenario,
  seed: number,
  model: RetailExperimentModel,
  error: Error,
  failureClass: 'configuration' | 'runtime',
): RetailExperimentRecord => ({
  schemaVersion: 1,
  matrixVersion: RETAIL_MATRIX_VERSION,
  metricSchemaVersion: RETAIL_METRIC_SCHEMA_VERSION,
  runId,
  scenarioId: scenario.scenarioId,
  seed,
  model,
  replicaIds: [...REPLICAS],
  initialStateHash: sha256(scenario.initialState),
  workloadHash: sha256(scenario),
  operationCount: scenario.operations.length,
  successfulDeliveryCount: null,
  scheduledDeliveryAttempts: null,
  blockedDeliveryAttempts: null,
  duplicateDeliveryCount: null,
  uniqueOperationsApplied: null,
  serializedOperationPayloadBytes: null,
  finalStateHash: null,
  finalStateBytes: null,
  metadataCounts: null,
  converged: false,
  failed: true,
  failureClass,
  error: error.message,
  scenario: clone(scenario),
})

const successfulRecord = (
  runId: string,
  scenario: RetailExperimentScenario,
  seed: number,
  model: RetailExperimentModel,
  report: RetailSimulationReport,
): RetailExperimentRecord => {
  const canonicalStates = REPLICAS.map((replicaId) => stateForHash(report.states[replicaId]))
  return {
    schemaVersion: 1,
    matrixVersion: RETAIL_MATRIX_VERSION,
    metricSchemaVersion: RETAIL_METRIC_SCHEMA_VERSION,
    runId,
    scenarioId: scenario.scenarioId,
    seed,
    model,
    replicaIds: [...REPLICAS],
    initialStateHash: sha256(scenario.initialState),
    workloadHash: sha256(scenario),
    operationCount: report.metrics.generatedOperations,
    scheduledDeliveryAttempts: report.metrics.scheduledDeliveryAttempts,
    blockedDeliveryAttempts: report.metrics.blockedDeliveryAttempts,
    successfulDeliveryCount: report.metrics.deliveries,
    duplicateDeliveryCount: report.metrics.duplicateDeliveries,
    uniqueOperationsApplied: report.metrics.uniqueOperationsApplied,
    serializedOperationPayloadBytes: report.metrics.bytesTransferred,
    finalStateHash: report.metrics.converged ? sha256(canonicalStates[0]) : null,
    finalStateBytes: report.metrics.converged ? bytes(canonicalStates[0]) : null,
    metadataCounts: report.metrics.finalMetadataCounts,
    converged: report.metrics.converged,
    failed: false,
    failureClass: undefined,
    error: undefined,
    scenario: clone(scenario),
  }
}

export const runRetailExperimentMatrix = (config: RetailExperimentConfig): RetailExperimentRecord[] => {
  validateConfig(config)
  return config.scenarioIds.flatMap((scenarioId) =>
    config.seeds.flatMap((seed) => {
      let scenario: RetailExperimentScenario
      try {
        scenario = buildScenario(scenarioId, seed)
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error))
      }
      return (['baseline', 'candidate'] as const).map((model) => {
        const runId = `${config.runPrefix ?? 'retail'}-${scenarioId}-${seed}-${model}`
        try {
          return successfulRecord(runId, scenario, seed, model, execute(scenario, model))
        } catch (error) {
          return failedRecord(runId, scenario, seed, model, error instanceof Error ? error : new Error(String(error)), 'runtime')
        }
      })
    }),
  )
}

export const summarizeRetailExperiments = (records: RetailExperimentRecord[]): RetailExperimentSummary => ({
  schemaVersion: 1,
  matrixVersion: RETAIL_MATRIX_VERSION,
  metricSchemaVersion: RETAIL_METRIC_SCHEMA_VERSION,
  groups: [...new Map(records.map((record) => [`${record.scenarioId}:${record.model}`, records.filter((candidate) => candidate.scenarioId === record.scenarioId && candidate.model === record.model)] as const)).entries()].map(
    ([key, grouped]) => {
      const [scenarioId, model] = key.split(':') as [string, RetailExperimentModel]
      const hashes = new Set(grouped.filter((record) => record.finalStateHash).map((record) => record.finalStateHash))
      return {
        scenarioId,
        model,
        runs: grouped.length,
        convergedRuns: grouped.filter((record) => record.converged).length,
        failedRuns: grouped.filter((record) => record.failed).length,
        nonConvergedRuns: grouped.filter((record) => !record.failed && !record.converged).length,
        finalStateHashAgreement: hashes.size ? hashes.size === 1 : null,
      }
    },
  ),
})

const writeExclusive = (path: string, content: string): void => {
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing research artifact: ${path}`)
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
}

export const writeRetailExperimentArtifacts = (
  directory: string,
  config: RetailExperimentConfig,
  records: RetailExperimentRecord[],
): void => {
  if (!directory.trim()) throw new Error('Research artifact directory is required')
  mkdirSync(directory, { recursive: true })
  const resolvedScenarios = [...new Map(records.map((record) => [record.scenarioId, record.scenario])).values()]
  writeExclusive(join(directory, 'config.json'), `${canonicalSerialize({ ...config, resolvedScenarios })}\n`)
  writeExclusive(join(directory, 'raw.jsonl'), `${records.map((record) => canonicalSerialize(record)).join('\n')}\n`)
  writeExclusive(join(directory, 'summary.json'), `${canonicalSerialize(summarizeRetailExperiments(records))}\n`)
}

export const buildRetailScenarioForTesting = (scenarioId: string, seed: number): RetailExperimentScenario =>
  buildScenario(scenarioId, seed)

export const runRetailScenario = (
  scenario: RetailExperimentScenario,
  seed: number,
  model: RetailExperimentModel,
  runId = `${scenario.scenarioId}-${seed}-${model}`,
): RetailExperimentRecord => {
  try {
    return successfulRecord(runId, scenario, seed, model, execute(scenario, model))
  } catch (error) {
    return failedRecord(
      runId,
      scenario,
      seed,
      model,
      error instanceof Error ? error : new Error(String(error)),
      'runtime',
    )
  }
}
