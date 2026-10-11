import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"

import { dirname } from "node:path"

export interface ReplicaRecord {
  replicaId: string

  state: unknown

  schemaVersion: number

  updatedAt: number
}

const clone = <T>(value: T): T => structuredClone(value)

export class ReplicaStore {
  private readonly db: Map<string, ReplicaRecord>

  constructor(initial = new Map<string, ReplicaRecord>()) {
    this.db = new Map(
      [...initial.entries()].map(([id, record]) => [id, clone(record)]),
    )
  }

  load(replicaId: string): ReplicaRecord | undefined {
    const record = this.db.get(replicaId)

    return record ? clone(record) : undefined
  }

  save(replicaId: string, state: unknown): ReplicaRecord {
    const record: ReplicaRecord = {
      replicaId,

      state,

      schemaVersion: 1,

      updatedAt: Date.now(),
    }

    const stored = clone(record)

    this.db.set(replicaId, stored)

    return clone(stored)
  }

  delete(replicaId: string): void {
    this.db.delete(replicaId)
  }

  clear(): void {
    this.db.clear()
  }
}

export class FileReplicaStore {
  constructor(private readonly filePath: string) {}

  load(replicaId: string): ReplicaRecord | undefined {
    const records = this.readRecords()

    const record = records[replicaId]

    return record ? clone(record) : undefined
  }

  save(replicaId: string, state: unknown): ReplicaRecord {
    const record: ReplicaRecord = {
      replicaId,
      state: clone(state),
      schemaVersion: 1,
      updatedAt: Date.now(),
    }

    const records = this.readRecords()

    records[replicaId] = record

    this.writeRecords(records)

    return clone(record)
  }

  delete(replicaId: string): void {
    const records = this.readRecords()

    delete records[replicaId]

    this.writeRecords(records)
  }

  clear(): void {
    this.writeRecords({})
  }

  private readRecords(): Record<string, ReplicaRecord> {
    if (!existsSync(this.filePath)) return {}

    let parsed: unknown

    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"))
    } catch (error) {
      throw new Error(
        `Unable to read replica store: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid replica store format")

    for (const [key, record] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        !record ||
        typeof record !== "object" ||
        (record as ReplicaRecord).replicaId !== key ||
        !Number.isInteger((record as ReplicaRecord).schemaVersion) ||
        (record as ReplicaRecord).schemaVersion < 1 ||
        !Number.isFinite((record as ReplicaRecord).updatedAt)
      ) {
        throw new Error("Invalid replica record")
      }
    }

    return parsed as Record<string, ReplicaRecord>
  }

  private writeRecords(records: Record<string, ReplicaRecord>): void {
    mkdirSync(dirname(this.filePath), { recursive: true })

    const temporaryPath = `${this.filePath}.tmp`

    try {
      writeFileSync(temporaryPath, JSON.stringify(records), "utf8")

      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      throw new Error(
        `Unable to write replica store: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
