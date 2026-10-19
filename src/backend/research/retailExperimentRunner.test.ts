import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  RETAIL_MATRIX_VERSION,
  RETAIL_METRIC_SCHEMA_VERSION,
  buildRetailScenarioForTesting,
  canonicalSerialize,
  runRetailExperimentMatrix,
  runRetailScenario,
  sha256,
  summarizeRetailExperiments,
  supportedRetailScenarioIds,
  writeRetailExperimentArtifacts,
  type RetailExperimentConfig,
} from './retailExperimentRunner'

const config: RetailExperimentConfig = {
  matrixVersion: RETAIL_MATRIX_VERSION,
  metricSchemaVersion: RETAIL_METRIC_SCHEMA_VERSION,
  scenarioIds: [...supportedRetailScenarioIds],
  seeds: [11, 23],
}

describe('reproducible retail experiment harness', () => {
  it('replays the same matrix deterministically', () => {
    const first = runRetailExperimentMatrix(config)
    const second = runRetailExperimentMatrix(config)

    expect(second).toEqual(first)
    expect(first.every((record) => record.workloadHash)).toBe(true)
    expect(first.every((record) => record.metricSchemaVersion === RETAIL_METRIC_SCHEMA_VERSION)).toBe(true)
  })

  it('uses identical workload and schedule hashes for baseline and candidate', () => {
    const records = runRetailExperimentMatrix({ ...config, scenarioIds: ['same-field'], seeds: [11] })

    expect(records).toHaveLength(2)
    expect(records[0].scenario).toEqual(records[1].scenario)
    expect(records[0].workloadHash).toBe(records[1].workloadHash)
    expect(records[0].initialStateHash).toBe(records[1].initialStateHash)
  })

  it('records every resolved scenario and varies intended schedules by seed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'syncdesk-retail-manifest-'))
    try {
      const records = runRetailExperimentMatrix({ ...config, scenarioIds: ['different-field'], seeds: [11, 23] })
      writeRetailExperimentArtifacts(directory, { ...config, scenarioIds: ['different-field'], seeds: [11, 23] }, records)
      const manifest = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
      expect(manifest.resolvedScenarios).toHaveLength(2)
      expect(manifest.resolvedScenarios[0].seed).not.toBe(manifest.resolvedScenarios[1].seed)
      expect(manifest.resolvedScenarios[0].scenario.schedule).not.toEqual(manifest.resolvedScenarios[1].scenario.schedule)
      expect(records[0].protocolStateConverged).toBe(true)
      expect(readFileSync(join(directory, 'manifest.json'), 'utf8')).toContain('"complete":true')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps no-conflict distinct from different-field', () => {
    const noConflict = buildRetailScenarioForTesting('no-conflict', 11)
    const differentField = buildRetailScenarioForTesting('different-field', 11)
    expect(noConflict.initialState.products).toHaveLength(2)
    expect(differentField.initialState.products).toHaveLength(1)
    expect(noConflict.operations).not.toEqual(differentField.operations)
  })

  it('generates every supported scenario with an explicit schedule', () => {
    const records = runRetailExperimentMatrix({ ...config, seeds: [11] })

    expect(new Set(records.map((record) => record.scenarioId))).toEqual(new Set(supportedRetailScenarioIds))
    expect(records.every((record) => record.scenario.schedule.length > 0)).toBe(true)
    expect(records.every((record) => record.scenario.operations.length > 0)).toBe(true)
    expect(records.every((record) => !record.failed)).toBe(true)
  })

  it('retains duplicate delivery accounting and partition actions', () => {
    const duplicate = runRetailExperimentMatrix({
      ...config,
      scenarioIds: ['duplicate-reordered'],
      seeds: [11],
    })
    const partition = buildRetailScenarioForTesting('partition-reconnect', 11)
    const partitionRecords = runRetailExperimentMatrix({
      ...config,
      scenarioIds: ['partition-reconnect'],
      seeds: [11],
    })

    expect(duplicate[0].duplicateDeliveryCount).toBeGreaterThan(0)
    expect(partitionRecords.every((record) => record.blockedDeliveryAttempts! > 0)).toBe(true)
    expect(partitionRecords.every((record) => record.successfulDeliveryCount === 6)).toBe(true)
    expect(partition.schedule).toEqual(
      expect.arrayContaining([
        { type: 'partition', replicaId: 'B' },
        { type: 'reconnect', replicaId: 'B' },
      ]),
    )
  })

  it('keeps non-converged baseline results instead of filtering them', () => {
    const records = runRetailExperimentMatrix({
      ...config,
      scenarioIds: ['same-field'],
      seeds: [11],
    })
    const baseline = records.find((record) => record.model === 'baseline')!
    const candidate = records.find((record) => record.model === 'candidate')!

    expect(baseline.failed).toBe(false)
    expect(baseline.converged).toBe(false)
    expect(candidate.converged).toBe(true)
    expect(summarizeRetailExperiments(records).groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'baseline', nonConvergedRuns: 1 }),
      ]),
    )
  })

  it('represents runtime failures with null metrics', () => {
    const scenario = buildRetailScenarioForTesting('same-field', 11)
    scenario.schedule = [{ type: 'local', replicaId: 'A', operationId: 'missing' }]
    const record = runRetailScenario(scenario, 11, 'baseline')

    expect(record.failed).toBe(true)
    expect(record.failureClass).toBe('runtime')
    expect(record.successfulDeliveryCount).toBeNull()
    expect(record.serializedOperationPayloadBytes).toBeNull()
    expect(record.error).toContain('unknown operation')
  })

  it('writes raw/config/summary artifacts without overwriting existing files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'syncdesk-retail-research-'))
    try {
      const records = runRetailExperimentMatrix({ ...config, scenarioIds: ['no-conflict'], seeds: [11] })
      writeRetailExperimentArtifacts(directory, { ...config, scenarioIds: ['no-conflict'], seeds: [11] }, records)

      expect(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).resolvedScenarios).toHaveLength(1)
      expect(readFileSync(join(directory, 'raw.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
      expect(JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8')).groups).toHaveLength(2)
      expect(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')).complete).toBe(true)
      expect(() => writeRetailExperimentArtifacts(directory, config, records)).toThrow('Refusing to overwrite')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects invalid configuration and canonicalizes object key order', () => {
    expect(() => runRetailExperimentMatrix({ ...config, scenarioIds: ['unknown'] })).toThrow('Invalid retail experiment configuration')
    expect(() => runRetailExperimentMatrix({ ...config, seeds: [Number.NaN] })).toThrow('safe integers')
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }))
    expect(canonicalSerialize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('does not publish a completion manifest after a partial write failure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'syncdesk-retail-partial-'))
    try {
      const records = runRetailExperimentMatrix({ ...config, scenarioIds: ['no-conflict'], seeds: [11] })
      let writes = 0
      expect(() =>
        writeRetailExperimentArtifacts(directory, { ...config, scenarioIds: ['no-conflict'], seeds: [11] }, records, {
          writeFile: (path, content) => {
            writes += 1
            if (writes === 2) throw new Error('simulated write failure')
            writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
          },
        }),
      ).toThrow('simulated write failure')
      expect(existsSync(join(directory, 'config.json'))).toBe(true)
      expect(existsSync(join(directory, 'manifest.json'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not turn unavailable metrics into zero', () => {
    const failed = runRetailScenario(buildRetailScenarioForTesting('same-field', 11), 11, 'candidate')
    expect(failed.failed).toBe(false)
    expect(failed.finalStateBytes).not.toBeNull()
    expect(failed.serializedOperationPayloadBytes).not.toBeNull()
  })
})
