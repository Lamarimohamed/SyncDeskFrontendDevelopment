import { mkdtempSync, readFileSync, rmSync } from "node:fs"

import { join } from "node:path"

import { tmpdir } from "node:os"

import { describe, expect, it } from "vitest"

import {
  readJsonl,
  runComparisonMatrix,
  runMatrix,
  summarize,
  writeJsonl,
  writeSummary,
  type RawExperimentRecord,
} from "./experimentRunner"

describe("reproducible experiment runner", () => {
  const matrix = {
    scenarios: [
      {
        scenarioId: "unicode",
        replicaIds: ["a", "b"],
        operationsPerReplica: 1,
        notes: "UTF-8 workload",
      },
    ],
    seeds: [1, 2],
  }

  it("creates distinct reproducible run IDs and preserves raw records", () => {
    const first = runMatrix(matrix)

    const second = runMatrix(matrix)

    expect(first).toEqual(second)

    expect(new Set(first.map((record) => record.runId)).size).toBe(2)

    expect(first.every((record) => record.operationCount === 2)).toBe(true)
  })

  it("writes JSONL and refuses accidental overwrite", () => {
    const directory = mkdtempSync(join(tmpdir(), "syncdesk-research-"))

    const path = join(directory, "raw.jsonl")

    try {
      const records = runMatrix(matrix)

      writeJsonl(path, records)

      expect(readJsonl(path)).toEqual(records)

      expect(() => writeJsonl(path, records)).toThrow("Refusing to overwrite")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("calculates descriptive statistics from known synthetic data", () => {
    const records = [1, 2, 3, 4].map((value, index) => ({
      schemaVersion: 1,
      runId: `r${index}`,
      system: "crdt",
      scenarioId: "s",
      seed: index,

      configuration: matrix.scenarios[0],
      operationCount: value,
      encodedApplicationPayloadBytes: value * 10,

      totalApplicationSynchronizationBytes: value * 20,
      converged: true,
      failed: false,

      appliedOperations: value,
      bufferedOperations: null,
      rejectedOperations: null,
      conflictedOperations: null,

      lostOperations: 0,
      convergenceTimeMs: 0,
      acknowledgementBytes: 0,
      retryBytes: 0,

      stateSizeBytes: value,
      metadataSizeBytes: value,
      tombstoneSizeBytes: 0,
      stateHashes: {},
    })) as RawExperimentRecord[]

    const summary = summarize(records)

    expect(summary.groups[0].metrics.operationCount.median).toBe(2.5)

    expect(summary.groups[0].metrics.operationCount.interquartileRange).toBe(
      1.5,
    )

    expect(summary.groups[0].metrics.operationCount.sampleCount).toBe(4)
  })

  it("serializes summaries separately from raw data", () => {
    const directory = mkdtempSync(join(tmpdir(), "syncdesk-summary-"))

    const path = join(directory, "summary.json")

    try {
      writeSummary(path, summarize(runMatrix(matrix)))

      expect(JSON.parse(readFileSync(path, "utf8")).groups).toBeDefined()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("records failed runs without inventing a convergence time", () => {
    const records = runMatrix({
      scenarios: [
        {
          scenarioId: "failed",
          replicaIds: ["a", "b"],
          operationsPerReplica: -1,
          notes: "invalid configuration",
        },
      ],
      seeds: [4],
    })
    expect(records[0].failed).toBe(true)
    expect(records[0].converged).toBe(false)
    expect(records[0].convergenceTimeMs).toBeNull()
    expect(records[0].error).toContain("Invalid experiment configuration")
  })

  it("rejects duplicate scenario or seed configuration", () => {
    expect(() =>
      runMatrix({
        scenarios: [matrix.scenarios[0], matrix.scenarios[0]],
        seeds: [1],
      }),
    ).toThrow("must be unique")
  })

  it("records both systems with explicit incomparable baseline byte fields", () => {
    const records = runComparisonMatrix({
      scenarios: matrix.scenarios,
      seeds: [1],
    })
    expect(records.map((record) => record.system)).toEqual([
      "crdt",
      "client-server-lww",
    ])
    expect(records[1].totalApplicationSynchronizationBytes).toBeNull()
    expect(records[1].converged).toBe(true)
  })
})
