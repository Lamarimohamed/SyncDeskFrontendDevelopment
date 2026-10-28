import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  defaultGcExperimentConfig,
  runGcExperiment,
  runGcExperimentMatrix,
  writeGcExperimentArtifacts,
} from "./gcExperiment"

describe("OR-Set GC experiment runner", () => {
  it("collects tombstones in the GC configuration and keeps them without GC", () => {
    const shared = {
      replicaCount: 3,
      operationsPerReplica: 6,
      rounds: 2,
      deleteRatio: 1,
      runPrefix: "test",
    }

    const withoutGc = runGcExperiment("online-no-gc", 11, shared)
    const withGc = runGcExperiment("online-gc", 11, shared)

    expect(withoutGc.failed).toBe(false)
    expect(withGc.failed).toBe(false)
    expect(withoutGc.converged).toBe(true)
    expect(withGc.converged).toBe(true)
    expect(withoutGc.deletedElementReappeared).toBe(false)
    expect(withGc.deletedElementReappeared).toBe(false)
    expect(withoutGc.tombstoneCount).toBeGreaterThan(0)
    expect(withGc.tombstoneCount).toBe(0)
    expect(withGc.tombstonesCollected).toBeGreaterThan(0)
    expect(withGc.tombstoneSizeBytes).toBeLessThan(withoutGc.tombstoneSizeBytes)
  })

  it("does not resurrect deletes after a delayed replica reconnects", () => {
    const record = runGcExperiment("delayed-replica-gc", 23, {
      replicaCount: 3,
      operationsPerReplica: 4,
      rounds: 3,
      deleteRatio: 1,
    })

    expect(record.failed).toBe(false)
    expect(record.converged).toBe(true)
    expect(record.deletedElementReappeared).toBe(false)
    expect(record.correctnessViolations).toBe(0)
  })

  it("is deterministic for the same seed and refuses artifact overwrite", () => {
    const config = defaultGcExperimentConfig({
      scenarioIds: ["online-gc"],
      seeds: [7],
      replicaCount: 2,
      operationsPerReplica: 3,
      rounds: 1,
      deleteRatio: 1,
    })

    expect(runGcExperimentMatrix(config)).toEqual(runGcExperimentMatrix(config))

    const directory = mkdtempSync(join(tmpdir(), "syncdesk-gc-"))

    try {
      writeGcExperimentArtifacts(directory, config, runGcExperimentMatrix(config))
      expect(readFileSync(join(directory, "manifest.json"), "utf8")).toContain(
        '"complete": true',
      )
      expect(() =>
        writeGcExperimentArtifacts(directory, config, runGcExperimentMatrix(config)),
      ).toThrow(/Refusing to overwrite/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
