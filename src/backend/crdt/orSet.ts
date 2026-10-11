export interface Tag {
  replicaId: string

  counter: number
}

export interface OrSetState<T extends string> {
  adds: Record<string, Tag[]>

  removes: Record<string, Tag[]>
}

const tagKey = (tag: Tag): string => `${tag.replicaId}:${tag.counter}`

export class OrSet<T extends string> {
  private readonly replicaId: string

  private nextCounter = 0

  private adds: Map<T, Map<string, Tag>> = new Map()

  private removes: Map<T, Map<string, Tag>> = new Map()

  constructor(replicaId: string) {
    if (!replicaId) throw new Error("Replica identity is required")

    this.replicaId = replicaId
  }

  add(value: T): Tag {
    const tag: Tag = { replicaId: this.replicaId, counter: ++this.nextCounter }

    const current = this.adds.get(value) ?? new Map<string, Tag>()

    current.set(tagKey(tag), tag)

    this.adds.set(value, current)

    return tag
  }

  remove(value: T): void {
    const current = this.adds.get(value)

    if (!current) return

    const tombstones = this.removes.get(value) ?? new Map<string, Tag>()

    for (const tag of current.values()) tombstones.set(tagKey(tag), tag)

    this.removes.set(value, tombstones)
  }

  has(value: T): boolean {
    const current = this.adds.get(value)

    if (!current) return false

    const tombstones = this.removes.get(value) ?? new Map()

    return Array.from(current.values()).some(
      (tag) => !tombstones.has(tagKey(tag)),
    )
  }

  values(): T[] {
    return Array.from(this.adds.keys()).filter((value) => this.has(value))
  }

  merge(other: OrSet<T>): void {
    for (const [value, tags] of other.adds) {
      const merged = this.adds.get(value) ?? new Map<string, Tag>()

      for (const tag of tags.values()) merged.set(tagKey(tag), tag)

      this.adds.set(value, merged)
    }

    for (const [value, tags] of other.removes) {
      const merged = this.removes.get(value) ?? new Map<string, Tag>()

      for (const tag of tags.values()) merged.set(tagKey(tag), tag)

      this.removes.set(value, merged)
    }
  }

  toJSON(): OrSetState<T> {
    const mapToArray = (value: Map<string, Tag>): Tag[] =>
      Array.from(value.values())

    const adds = Object.fromEntries(
      Array.from(this.adds.entries()).map(([key, tags]) => [
        key,
        mapToArray(tags),
      ]),
    ) as Record<string, Tag[]>

    const removes = Object.fromEntries(
      Array.from(this.removes.entries()).map(([key, tags]) => [
        key,
        mapToArray(tags),
      ]),
    ) as Record<string, Tag[]>

    return { adds, removes }
  }

  static fromJSON<T extends string,>(
    replicaId: string,
    state: OrSetState<T>,
  ): OrSet<T> {
    if (!state || typeof state !== "object" || !state.adds || !state.removes)
      throw new Error("Invalid OR-Set state")

    const set = new OrSet<T>(replicaId)

    const restore = (source: Record<string, Tag[]>): Map<T, Map<string, Tag>> =>
      new Map(
        Object.entries(source).map(([key, tags]) => {
          if (!Array.isArray(tags)) throw new Error("Invalid OR-Set tags")

          const restored = tags.map((tag) => {
            if (
              !tag ||
              !tag.replicaId ||
              !Number.isSafeInteger(tag.counter) ||
              tag.counter <= 0
            )
              throw new Error("Invalid OR-Set tag")

            return { replicaId: tag.replicaId, counter: tag.counter }
          })

          return [key as T, new Map(restored.map((tag) => [tagKey(tag), tag]))]
        }),
      )

    set.adds = restore(state.adds)

    set.removes = restore(state.removes)

    const ownCounters = [...set.adds.values(), ...set.removes.values()]

      .flatMap((tags) => [...tags.values()])

      .filter((tag) => tag.replicaId === replicaId)

      .map((tag) => tag.counter)

    set.nextCounter = ownCounters.length ? Math.max(...ownCounters) : 0

    return set
  }
}
