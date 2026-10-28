export class ReplicaMembership {
  private readonly members = new Set<string>()

  private readonly retired = new Set<string>()

  constructor(memberIds: readonly string[]) {
    if (!memberIds.length) throw new Error("Replica membership must be non-empty")

    if (new Set(memberIds).size !== memberIds.length || memberIds.some((id) => !id))
      throw new Error("Replica identities must be unique")

    memberIds.forEach((id) => this.members.add(id))
  }

  list(): string[] {
    return [...this.members]
  }

  includes(replicaId: string): boolean {
    return this.members.has(replicaId)
  }

  isRetired(replicaId: string): boolean {
    return this.retired.has(replicaId)
  }

  forget(replicaId: string): void {
    if (!this.members.has(replicaId))
      throw new Error(`Cannot forget unknown replica: ${replicaId}`)

    if (this.members.size <= 1)
      throw new Error("Cannot forget the last remaining replica")

    this.members.delete(replicaId)
    this.retired.add(replicaId)
  }

  join(replicaId: string): void {
    if (!replicaId) throw new Error("Replica identity is required")

    if (this.members.has(replicaId) || this.retired.has(replicaId))
      throw new Error(
        "Replica identity cannot be reused after it has joined or been forgotten",
      )

    this.members.add(replicaId)
  }
}
