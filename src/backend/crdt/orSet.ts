export interface Tag {
  replicaId: string

  counter: number
}

export interface RemoveEvent {
  replicaId: string

  counter: number
}

export interface RemovedTag extends Tag {
  // Remove event that tombstoned this tag. Absent on legacy tombstones, which
  // are therefore never garbage-collectable.
  removedBy?: RemoveEvent
}

export interface OrSetState<T extends string> {
  adds: Record<string, Tag[]>

  removes: Record<string, RemovedTag[]>

  // Knowledge vector of remove events: event origin -> highest observed event
  // counter. Max-merged on every merge.
  removeVector?: Record<string, number>

  // Per-source observation matrix: for every replica whose state was directly
  // merged, the knowledge vector observed from it. This is the evidence used
  // for causal-stability decisions; an absent source blocks collection.
  observedRemoveVectors?: Record<string, Record<string, number>>

  // Highest add-tag counter ever issued locally. GC removes tags from the
  // serialized state, so this watermark prevents a restored replica from
  // reissuing a tag identity that other replicas still remember.
  addCounterWatermark?: number
}

export interface OrSetStats {
  addTagCount: number

  tombstoneCount: number

  removeVectorSize: number

  observedSourceCount: number
}

export interface GarbageCollectionResult {
  tombstonesCollected: number

  tagsCollected: number
}

const tagKey = (tag: Tag): string => `${tag.replicaId}:${tag.counter}`

const isValidRemoveEvent = (event: RemoveEvent): boolean =>
  Boolean(event) &&
  typeof event.replicaId === "string" &&
  event.replicaId.length > 0 &&
  Number.isSafeInteger(event.counter) &&
  event.counter > 0

const compareRemoveEvents = (left: RemoveEvent, right: RemoveEvent): number =>
  left.counter !== right.counter
    ? left.counter - right.counter
    : left.replicaId < right.replicaId
      ? -1
      : left.replicaId > right.replicaId
        ? 1
        : 0

// A tombstone is kept under the greatest covering remove event. Every covering
// event is a genuine remove of the tag, and stability of any one of them implies
// every replica holds a tombstone for the tag, so keeping the greatest is a safe
// deterministic choice that only ever delays collection.
const preferredTombstone = (
  left: RemovedTag,
  right: RemovedTag,
): RemovedTag => {
  if (left.removedBy && right.removedBy)
    return compareRemoveEvents(left.removedBy, right.removedBy) >= 0
      ? left
      : right

  return left.removedBy ? left : right
}

const maxMergeVectors = (
  target: Record<string, number>,
  source: Record<string, number>,
): void => {
  for (const [replicaId, counter] of Object.entries(source))
    target[replicaId] = Math.max(target[replicaId] ?? 0, counter)
}

export class OrSet<T extends string> {
  private readonly replicaId: string

  private nextCounter = 0

  private nextRemoveCounter = 0

  private removeVector: Record<string, number> = {}

  private observedRemoveVectors: Map<string, Record<string, number>> = new Map()

  private adds: Map<T, Map<string, Tag>> = new Map()

  private removes: Map<T, Map<string, RemovedTag>> = new Map()

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

  remove(value: T): RemoveEvent | null {
    const current = this.adds.get(value)

    if (!current || current.size === 0) return null

    const event: RemoveEvent = {
      replicaId: this.replicaId,
      counter: ++this.nextRemoveCounter,
    }

    this.removeVector[this.replicaId] = event.counter

    const tombstones = this.removes.get(value) ?? new Map<string, RemovedTag>()

    for (const tag of current.values())
      tombstones.set(tagKey(tag), { ...tag, removedBy: { ...event } })

    this.removes.set(value, tombstones)

    return event
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

    for (const [value, tombstones] of other.removes) {
      const merged = this.removes.get(value) ?? new Map<string, RemovedTag>()

      for (const [key, entry] of tombstones) {
        const existing = merged.get(key)

        merged.set(key, existing ? preferredTombstone(existing, entry) : entry)
      }

      this.removes.set(value, merged)
    }

    maxMergeVectors(this.removeVector, other.removeVector)

    const observed = this.observedRemoveVectors.get(other.replicaId) ?? {}

    maxMergeVectors(observed, other.removeVector)

    this.observedRemoveVectors.set(other.replicaId, observed)
  }

  // Causal-stability garbage collection. A tombstone entry may be discarded,
  // together with the add tag it covers, once its covering remove event is
  // known to have reached every replica in the membership. Knowledge is
  // evidence-based: the collecting replica must have directly merged a state
  // from every other member in which that member's knowledge vector covered
  // the event. Because a remove event and the vector advance it produces
  // travel in the same snapshot, and both removes and vectors only grow, a
  // source whose vector covered the event also carried the tombstone (or has
  // already collected it), so no replica can later deliver the covered add tag
  // without its tombstone.
  // Assumes static membership: every replica that may ever deliver state must
  // appear in `membership`, including permanently offline ones, whose missing
  // observation keeps collection blocked.
  garbageCollect(membership: readonly string[]): GarbageCollectionResult {
    if (!membership.length || !membership.includes(this.replicaId))
      throw new Error(
        "Garbage collection membership must be non-empty and include the local replica",
      )

    const stable = (event: RemoveEvent): boolean =>
      membership.every((member) => {
        if (member === this.replicaId)
          return (this.removeVector[event.replicaId] ?? 0) >= event.counter

        const observed = this.observedRemoveVectors.get(member)

        return (observed?.[event.replicaId] ?? 0) >= event.counter
      })

    let tombstonesCollected = 0

    let tagsCollected = 0

    for (const [value, tombstones] of this.removes) {
      const kept = new Map<string, RemovedTag>()

      for (const [key, entry] of tombstones) {
        const removedBy = entry.removedBy

        if (removedBy && stable(removedBy)) {
          tombstonesCollected += 1

          if (this.adds.get(value)?.delete(key)) tagsCollected += 1
        } else {
          kept.set(key, entry)
        }
      }

      if (kept.size) this.removes.set(value, kept)
      else this.removes.delete(value)

      if (this.adds.get(value)?.size === 0) this.adds.delete(value)
    }

    return { tombstonesCollected, tagsCollected }
  }

  stats(): OrSetStats {
    const addTagCount = [...this.adds.values()].reduce(
      (total, tags) => total + tags.size,
      0,
    )

    const tombstoneCount = [...this.removes.values()].reduce(
      (total, tombstones) => total + tombstones.size,
      0,
    )

    return {
      addTagCount,
      tombstoneCount,
      removeVectorSize: Object.keys(this.removeVector).length,
      observedSourceCount: this.observedRemoveVectors.size,
    }
  }

  restore(state: OrSetState<T>): void {
    const restored = OrSet.fromJSON<T>(this.replicaId, state)

    this.adds = restored.adds

    this.removes = restored.removes

    this.removeVector = restored.removeVector

    this.observedRemoveVectors = restored.observedRemoveVectors

    this.nextCounter = restored.nextCounter

    this.nextRemoveCounter = restored.nextRemoveCounter
  }

  toJSON(): OrSetState<T> {
    const mapToArray = <E>(value: Map<string, E>): E[] =>
      Array.from(value.values())

    const adds = Object.fromEntries(
      Array.from(this.adds.entries()).map(([key, tags]) => [
        key,
        mapToArray(tags),
      ]),
    ) as Record<string, Tag[]>

    const removes = Object.fromEntries(
      Array.from(this.removes.entries()).map(([key, tombstones]) => [
        key,
        mapToArray(tombstones),
      ]),
    ) as Record<string, RemovedTag[]>

    return {
      adds,
      removes,
      removeVector: { ...this.removeVector },
      observedRemoveVectors: Object.fromEntries(
        Array.from(this.observedRemoveVectors.entries()).map(
          ([source, vector]) => [source, { ...vector }],
        ),
      ),
      addCounterWatermark: this.nextCounter,
    }
  }

  static fromJSON<T extends string,>(
    replicaId: string,
    state: OrSetState<T>,
  ): OrSet<T> {
    if (!state || typeof state !== "object" || !state.adds || !state.removes)
      throw new Error("Invalid OR-Set state")

    const set = new OrSet<T>(replicaId)

    const restoreTags = (tags: unknown): Tag => {
      if (
        !tags ||
        typeof tags !== "object" ||
        typeof (tags as Tag).replicaId !== "string" ||
        !(tags as Tag).replicaId ||
        !Number.isSafeInteger((tags as Tag).counter) ||
        (tags as Tag).counter <= 0
      )
        throw new Error("Invalid OR-Set tag")

      return {
        replicaId: (tags as Tag).replicaId,
        counter: (tags as Tag).counter,
      }
    }

    const restoreAdds = (
      source: Record<string, Tag[]>,
    ): Map<T, Map<string, Tag>> =>
      new Map(
        Object.entries(source).map(([key, tags]) => {
          if (!Array.isArray(tags)) throw new Error("Invalid OR-Set tags")

          const restored = tags.map((tag) => {
            const restoredTag = restoreTags(tag)

            return [tagKey(restoredTag), restoredTag] as const
          })

          return [key as T, new Map(restored)]
        }),
      )

    const restoreRemoves = (
      source: Record<string, RemovedTag[]>,
    ): Map<T, Map<string, RemovedTag>> =>
      new Map(
        Object.entries(source).map(([key, entries]) => {
          if (!Array.isArray(entries)) throw new Error("Invalid OR-Set tags")

          const restored = entries.map((entry) => {
            const tag = restoreTags(entry)

            if (entry.removedBy !== undefined) {
              if (!isValidRemoveEvent(entry.removedBy))
                throw new Error("Invalid OR-Set remove event")

              return [
                tagKey(tag),
                {
                  ...tag,
                  removedBy: {
                    replicaId: entry.removedBy.replicaId,
                    counter: entry.removedBy.counter,
                  },
                } satisfies RemovedTag,
              ] as const
            }

            return [tagKey(tag), tag] as const
          })

          return [key as T, new Map(restored)]
        }),
      )

    set.adds = restoreAdds(state.adds)

    set.removes = restoreRemoves(state.removes as Record<string, RemovedTag[]>)

    if (state.removeVector !== undefined) {
      if (
        typeof state.removeVector !== "object" ||
        state.removeVector === null
      )
        throw new Error("Invalid OR-Set remove vector")

      for (const [origin, counter] of Object.entries(state.removeVector)) {
        if (!origin || !Number.isSafeInteger(counter) || counter < 0)
          throw new Error("Invalid OR-Set remove vector entry")

        set.removeVector[origin] = counter
      }
    }

    if (state.observedRemoveVectors !== undefined) {
      if (
        typeof state.observedRemoveVectors !== "object" ||
        state.observedRemoveVectors === null
      )
        throw new Error("Invalid OR-Set observation matrix")

      for (const [source, vector] of Object.entries(
        state.observedRemoveVectors,
      )) {
        if (!source || !vector || typeof vector !== "object")
          throw new Error("Invalid OR-Set observation matrix entry")

        const observed: Record<string, number> = {}

        for (const [origin, counter] of Object.entries(vector)) {
          if (!origin || !Number.isSafeInteger(counter) || counter < 0)
            throw new Error("Invalid OR-Set observation matrix entry")

          observed[origin] = counter
        }

        set.observedRemoveVectors.set(source, observed)
      }
    }

    const ownCounters = [...set.adds.values(), ...set.removes.values()]
      .flatMap((entries) => [...entries.values()])
      .filter((tag) => tag.replicaId === replicaId)
      .map((tag) => tag.counter)

    const derivedCounter = ownCounters.length ? Math.max(...ownCounters) : 0

    set.nextCounter =
      state.addCounterWatermark !== undefined
        ? Math.max(
            Number.isSafeInteger(state.addCounterWatermark)
              ? state.addCounterWatermark
              : 0,
            derivedCounter,
          )
        : derivedCounter

    set.nextRemoveCounter = set.removeVector[replicaId] ?? 0

    return set
  }
}
