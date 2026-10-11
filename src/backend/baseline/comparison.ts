import { createHash } from "node:crypto"

import { ClientServerLwwBaseline } from "./clientServerLww"

import { ReplicaSimulator } from "../sync/simulator"

export interface ComparableScenarioConfig {
  scenarioId: string

  seed: number

  replicaIds?: string[]

  operationsPerReplica?: number

  disconnectedReplica?: string
}

export interface ComparableScenarioResult {
  scenarioId: string

  seed: number

  operationCount: number

  crdt: {
    converged: boolean
    stateHash: string
    messageCount: number
  }

  baseline: {
    authoritative: boolean

    stateHash: string

    submitted: number

    buffered: number

    conflicts: number
  }
}

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

export const runComparableScenario = (
  config: ComparableScenarioConfig,
): ComparableScenarioResult => {
  const replicaIds = config.replicaIds ?? ["r1", "r2", "r3", "r4"]

  const operationsPerReplica = config.operationsPerReplica ?? 2

  const simulator = new ReplicaSimulator<string>(config.seed, replicaIds)

  const baseline = new ClientServerLwwBaseline()

  for (const replicaId of replicaIds)
    baseline.registerClient(
      replicaId,

      replicaId !== config.disconnectedReplica,
    )

  let operationCount = 0

  for (const replicaId of replicaIds) {
    for (let index = 0; index < operationsPerReplica; index += 1) {
      const operationId = `${config.scenarioId}-${replicaId}-${index}`

      const value = `${replicaId}-${index}`

      simulator.update(replicaId, (replica) => {
        replica.add(value)

        replica.incrementCounter()
      })

      baseline.submit(
        baseline.createOperation(
          replicaId,

          operationId,

          value,

          config.seed + index,
        ),
      )

      operationCount += 1
    }
  }

  if (config.disconnectedReplica)
    baseline.setConnected(config.disconnectedReplica, true)

  for (const from of replicaIds) {
    for (const target of replicaIds) {
      if (from !== target)
        simulator.send(from, target, {
          delay: (from.length + target.length) % 3,
        })
    }
  }

  simulator.deliverAll()

  const report = simulator.report(config.seed)

  const representative = report.snapshots[replicaIds[0]]

  return {
    scenarioId: config.scenarioId,

    seed: config.seed,

    operationCount,

    crdt: {
      converged: report.converged,

      stateHash: digest({
        register: representative.register,

        set: representative.set,

        counter: representative.counter,
      }),

      messageCount: replicaIds.length * (replicaIds.length - 1),
    },

    baseline: {
      authoritative: true,

      stateHash: digest(baseline.getState()),

      submitted: baseline.getStats().submitted,

      buffered: baseline.getStats().buffered,

      conflicts: baseline.getStats().conflicts,
    },
  }
}
