import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

import { dirname } from "node:path"

export interface ReplicaRecord {
  replicaId: string

  state: unknown

  schemaVersion: number

  updatedAt: number

  revision?: number
}

const clone = <T>(value: T): T => structuredClone(value)

const validateReplacementRecord = (
  replicaId: string,
  record: ReplicaRecord,
): void => {
  if (
    record.replicaId !== replicaId ||
    !Number.isInteger(record.schemaVersion) ||
    record.schemaVersion < 1 ||
    !Number.isFinite(record.updatedAt)
  ) {
    throw new Error(`Invalid replacement record for replica ${replicaId}`)
  }
}

export interface RevisionedReplicaRecord {
  record: ReplicaRecord

  revision: number
}

export class ReplicaRevisionConflictError extends Error {
  constructor(replicaId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Replica record ${replicaId} changed from revision ${expectedRevision} to ${actualRevision}`,
    )
    this.name = "ReplicaRevisionConflictError"
  }
}

export class FileReplicaStoreLockError extends Error {
  constructor(lockPath: string) {
    super(`Replica store is already being written: ${lockPath}`)
    this.name = "FileReplicaStoreLockError"
  }
}

export interface RevisionedReplicaStore {
  loadWithRevision(replicaId: string): RevisionedReplicaRecord | undefined

  replaceIfRevision(
    replicaId: string,
    expectedRevision: number,
    record: ReplicaRecord,
  ): ReplicaRecord
}

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
    const current = this.db.get(replicaId)
    const record: ReplicaRecord = {
      replicaId,
      state,
      schemaVersion: 1,
      updatedAt: Date.now(),
      revision: (current?.revision ?? 0) + 1,
    }

    const stored = clone(record)

    this.db.set(replicaId, stored)

    return clone(stored)
  }

  loadWithRevision(replicaId: string): RevisionedReplicaRecord | undefined {
    const record = this.db.get(replicaId)

    if (!record) return undefined

    const revision = record.revision ?? 0

    return { record: clone(record), revision }
  }

  replaceIfRevision(
    replicaId: string,
    expectedRevision: number,
    record: ReplicaRecord,
  ): ReplicaRecord {
    validateReplacementRecord(replicaId, record)

    const current = this.db.get(replicaId)
    const actualRevision = current?.revision ?? 0

    if (actualRevision !== expectedRevision)
      throw new ReplicaRevisionConflictError(
        replicaId,
        expectedRevision,
        actualRevision,
      )

    const stored = clone({
      ...record,
      replicaId,
      revision: expectedRevision + 1,
    })

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
    return this.withWriteLock(() => {
      const records = this.readRecords()
      const record = this.createRecord(
        replicaId,
        state,
        (records[replicaId]?.revision ?? 0) + 1,
        1,
      )

      records[replicaId] = record
      this.writeRecords(records)

      return clone(record)
    })
  }

  loadWithRevision(replicaId: string): RevisionedReplicaRecord | undefined {
    const records = this.readRecords()
    const record = records[replicaId]

    if (!record) return undefined

    return {
      record: clone(record),
      revision: record.revision ?? 0,
    }
  }

  replaceIfRevision(
    replicaId: string,
    expectedRevision: number,
    record: ReplicaRecord,
  ): ReplicaRecord {
    validateReplacementRecord(replicaId, record)

    return this.withWriteLock(() => {
      const records = this.readRecords()
      const current = records[replicaId]
      const actualRevision = current?.revision ?? 0

      if (actualRevision !== expectedRevision)
        throw new ReplicaRevisionConflictError(
          replicaId,
          expectedRevision,
          actualRevision,
        )

      const replacement = this.createRecord(
        replicaId,
        record.state,
        expectedRevision + 1,
        record.schemaVersion,
        record.updatedAt,
      )

      records[replicaId] = replacement
      this.writeRecords(records)

      return clone(replacement)
    })
  }

  private createRecord(
    replicaId: string,
    state: unknown,
    revision: number,
    schemaVersion: number,
    updatedAt = Date.now(),
  ): ReplicaRecord {
    const record: ReplicaRecord = {
      replicaId,
      state: clone(state),
      schemaVersion,
      updatedAt,
      revision,
    }
    return record
  }

  delete(replicaId: string): void {
    this.withWriteLock(() => {
      const records = this.readRecords()
      delete records[replicaId]
      this.writeRecords(records)
    })
  }

  clear(): void {
    this.withWriteLock(() => {
      this.writeRecords({})
    })
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

  private withWriteLock<T>(operation: () => T): T {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const lockPath = `${this.filePath}.lock`
    let lockHandle: number

    try {
      lockHandle = openSync(lockPath, "wx")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new FileReplicaStoreLockError(lockPath)
      throw new Error(
        `Unable to acquire replica store lock: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    try {
      return operation()
    } finally {
      closeSync(lockHandle)
      unlinkSync(lockPath)
    }
  }
}
