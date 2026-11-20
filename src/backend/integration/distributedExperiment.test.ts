import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startBackendServer } from '../api/server'
import {
  runDistributedExperiment,
  SUPPORTED_DISTRIBUTED_SCENARIOS,
} from '../../../scripts/run-distributed-experiment.mjs'

describe('v2 distributed experiment runner across reproducible network scenarios', () => {
  it.each([
    'normal-connectivity',
    'high-latency',
    'packet-loss',
    'short-disconnection',
    'long-partition',
    'reconnection',
    'concurrent-updates-during-partition',
  ] as const)(
    'executes %s across 3 independent HTTP backend replicas and converges with v2 operations',
    async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), `syncdesk-exp-${scenario}-`))
      const servers = await Promise.all([
        startBackendServer({ port: 0, replicaId: 'replica-a' }),
        startBackendServer({ port: 0, replicaId: 'replica-b' }),
        startBackendServer({ port: 0, replicaId: 'replica-c' }),
      ])
      const replicaUrls = servers.map((server) => `http://127.0.0.1:${server.port}`)
      const outputPath = join(directory, `${scenario}.json`)

      try {
        const result = await runDistributedExperiment({
          replicaUrls,
          scenario,
          seed: 20261120,
          operationsPerReplica: 2,
          outputPath,
          gitCommit: 'test-commit',
        })

        expect(result.schemaVersion).toBe(2)
        expect(result.protocolVersion).toBe('syncdesk-retail-v2')
        expect(result.scenario).toBe(scenario)
        expect(result.replicaIds).toEqual(['replica-a', 'replica-b', 'replica-c'])
        expect(result.converged).toBe(true)
        expect(result.semanticCorrect).toBe(true)
        expect(result.operationsCorrect).toBe(true)
        expect(result.metadataConverged).toBe(true)
        expect(result.finalCorrectness).toBe(true)
        expect(result.operationsRejected).toBe(0)
        expect(result.bytesSent).toBeGreaterThan(0)
        expect(result.bytesReceived).toBeGreaterThan(0)
        expect(result.totalBytesExchanged).toBe(result.bytesSent + result.bytesReceived)
        expect(result.stockOperationOutcomes.applied).toBeGreaterThan(0)
        if (scenario === 'packet-loss') {
          expect(result.simulatedPacketDrops).toBeGreaterThan(0)
        }
      } finally {
        await Promise.all(servers.map((server) => server.close()))
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it('fails explicitly when convergence timeout is exceeded', async () => {
    const server = await startBackendServer({ port: 0, replicaId: 'timeout-replica' })
    try {
      await expect(
        runDistributedExperiment({
          replicaUrls: [`http://127.0.0.1:${server.port}`],
          scenario: 'high-latency',
          latencyMs: 50,
          timeoutMs: 10,
          writeOutput: false,
        }),
      ).rejects.toThrow(/exceeded convergence timeout/)
    } finally {
      await server.close()
    }
  })

  it('exposes all required experimental scenarios', () => {
    expect(SUPPORTED_DISTRIBUTED_SCENARIOS).toEqual(
      expect.arrayContaining([
        'normal-connectivity',
        'high-latency',
        'packet-loss',
        'short-disconnection',
        'long-partition',
        'reconnection',
        'concurrent-updates-during-partition',
      ]),
    )
  })
})
