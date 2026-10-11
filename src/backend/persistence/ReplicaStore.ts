export interface ReplicaRecord {
  replicaId: string
  state: unknown
  schemaVersion: number
  updatedAt: number
}

export class ReplicaStore {
  private readonly db: Map<string, ReplicaRecord>

  constructor(initial = new Map<string, ReplicaRecord>()) {
    this.db = initial
  }

  load(replicaId: string): ReplicaRecord | undefined {
    return this.db.get(replicaId)
  }

  save(replicaId: string, state: unknown): ReplicaRecord {
    const record: ReplicaRecord = {
      replicaId,
      state,
      schemaVersion: 1,
      updatedAt: Date.now(),
    }

    this.db.set(replicaId, record)
    return record
  }

  delete(replicaId: string): void {
    this.db.delete(replicaId)
  }

  clear(): void {
    this.db.clear()
  }
}
