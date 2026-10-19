# Retail Conflict Model and Convergence Specification

Status: design and capability audit only. This document does not claim that
multi-replica retail convergence is implemented.

## Current repository state

The latest committed integration is `bb9d014` (`Add versioned retail sync and
migration foundation`). The current V2 migration work remains isolated from
the production runtime.

The current generic replica contains:

- one string LWW register;
- one OR-Set of strings;
- one PN-counter;
- a replica identity and hybrid logical clock;
- message-ID deduplication at the reliable endpoint.

The retail API stores a separate authoritative product/category projection and
records each accepted operation in the existing OR-Set and PN-counter. That
projection is not currently a multi-replica CRDT.

## Retail data model

| Data | Required synchronized representation | Required conflict semantics | Current capability |
| --- | --- | --- | --- |
| Product `name`, `nameAr`, `description`, `descriptionAr` | Independent field registers or a versioned product map | Concurrent different-field edits should both survive; same-field edits need deterministic LWW tie-breaking | Not supported by the single generic register |
| Product `price`, `availability`, `lowStockThreshold` | Independent field registers | Deterministic per-field LWW | Not supported as a multi-replica model |
| Product `categoryId` | LWW field plus referential validation | Deterministic winner; category deletion needs an explicit policy | Current API accepts whole-record authoritative writes only |
| Product identity and membership | Add/remove set with operation tags | Add/remove and delete/update ordering must be explicit | Retail server projection supports sequential operations, not replica merge |
| Product deletion/restoration | Remove tombstone with causal/version metadata | Delete wins over older updates; restoration must be a new versioned operation | Local tombstones exist; backend retail tombstones do not |
| Category fields | Independent field registers or versioned map | Same-field deterministic LWW | Current API accepts whole-record authoritative writes only |
| Category/product relationship | Referential constraint plus category existence policy | Define behavior when category is deleted concurrently with product update | Validated locally; not multi-replica resolved |
| Inventory quantity | PN-counter or domain-specific reservation/stock ledger | Concurrent increments/decrements merge without double application | Generic PN-counter exists, but stock is not persisted in backend retail catalog |
| Operation identity | Globally unique operation ID scoped to replica identity | Duplicate delivery is a no-op | Retail operation IDs are persisted and deduplicated |
| Replica identity/version | Stable replica ID plus HLC/version vector or equivalent | Out-of-order operations must be comparable or causally ordered | HLC exists; retail operations do not carry causal versions |

## Candidate model

The smallest credible multi-replica design would use:

1. A versioned entity map keyed by product/category ID.
2. Independent LWW registers for independently editable scalar fields.
3. A membership/tombstone component for create/delete/restore.
4. Explicit causal metadata per operation, preferably an HLC plus a causal
   context or version vector.
5. A PN-counter only for additive inventory deltas, not for absolute stock
   replacement.
6. A separate business policy for overselling, reservations, and corrections.

An OR-Set is appropriate for operation or membership tags, but by itself it
does not resolve a product's fields or define delete-versus-update behavior.
A PN-counter is mergeable and idempotent under state merge, but it does not
prevent overselling and cannot represent an absolute counted inventory value
without an additional correction/version policy.

## Required convergence assumptions

The following assumptions are required before claiming convergence:

- replicas have stable, unique identities;
- messages are eventually delivered;
- messages may be duplicated or reordered;
- all replicas implement the same protocol and merge rules;
- state snapshots are valid and compatible;
- operation IDs are never reused for different operations;
- tombstones are retained for at least the maximum period in which an older
  update can arrive;
- clients do not silently discard operations after local acknowledgement.

Under those assumptions, convergence means that replicas which have processed
the same complete set of operations produce identical canonical state. It does
not mean that the resulting state is commercially correct: for example, a
convergent PN-counter can still allow two offline devices to sell the last
unit.

## Deterministic test plan

All scenarios use fixed replica IDs, fixed HLC times, fixed operation IDs, and
an explicit delivery schedule. Each scenario must compare canonical serialized
state rather than object identity.

| Scenario | Schedule | Expected property | Current status |
| --- | --- | --- | --- |
| Different product fields | A changes `name`; B changes `price`; exchange all operations in both orders | Both changes survive | Requires field-level product model; not implemented |
| Same product field | A and B change `price` at equal logical time with replica-ID tie-break | Same winner at all replicas | Generic LWW primitive supports this; retail projection does not |
| Delete versus update | A deletes; B updates while partitioned; exchange both orders | Explicit delete-wins or versioned restore rule | Not defined by retail API |
| Duplicate delivery | Deliver one operation twice to each replica | State and operation accounting unchanged after first delivery | Operation IDs are deduplicated in the server; multi-replica retail path not implemented |
| Reordered delivery | Deliver newer and older updates in reverse order | Older operation cannot overwrite newer state | Requires causal/version metadata on retail operations |
| Partition/reconnect | Three replicas edit during partition, then exchange every operation | All replicas reach the same canonical state | Generic simulator covers generic CRDT state; retail catalog does not |
| Three delivery orders | Same three operations delivered in three permutations | Canonical results are equal | Generic state merge is testable; retail operation ordering is currently authoritative |
| Concurrent stock increments | A `+2`, B `+3`; exchange states | Quantity delta is `+5`, once | PN-counter primitive supports this |
| Concurrent stock decrement | A `-1`, B `-2`; exchange states | Quantity delta is `-3`; business invariant checked separately | PN-counter supports arithmetic, not oversell prevention |
| Hydration with pending edit | Local pending update, remote catalog update/delete | Pending local entity is retained | Implemented and tested |
| Restart and tombstones | Hydrate, persist, restart local repository, hydrate again | No duplicate records; tombstone behavior stable | Implemented for local product tombstones |

## Current verified properties

The existing primitive tests and deterministic simulator establish:

- PN-counter state merge uses per-replica component-wise maxima;
- OR-Set state merge is idempotent and preserves observed remove tags;
- LWW register merge uses deterministic HLC ordering;
- generic replicas converge after complete exchange of compatible state;
- duplicate generic messages are recognized by message ID;
- the retail single-server catalog applies duplicate operation IDs only once;
- local hydration preserves pending entities and is idempotent.

These results do not establish multi-replica retail convergence.

## Deterministic three-replica research simulator

`src/backend/research/retailSimulator.ts` provides a test-only simulator with
independent replicas `A`, `B`, and `C`. It does not add transport or change the
backend API. A scenario explicitly creates a local operation, queues it for a
target, optionally duplicates or delays that delivery, and chooses when to
deliver queued operations. A replica can be partitioned and later reconnected;
`reconnectAndDeliverAll()` reconnects all replicas and drains the queue.

The simulator records generated operations, every delivery (including
duplicate deliveries), unique operation IDs applied, UTF-8 JSON bytes queued
for transfer, final serialized state bytes, and applied-operation metadata
counts. Canonical state comparison sorts object keys and collections so the
convergence result is reproducible.

The simulator now has two explicit modes. `baseline` is the current
arrival-order projection and is retained to expose the existing limitation.
`candidate` is a research-only versioned model; it does not change the current
whole-record retail API.

In candidate mode, product and category scalar fields are independent
registers. Every candidate operation must carry `{ logicalTime, replicaId,
operationId }` metadata. Versions are ordered by logical time, then replica
ID, then operation ID, making equal-time same-field conflicts deterministic.
Duplicate operation IDs are idempotent within a replica, and a register keeps
the greatest version when deliveries are reordered.

Product deletion creates a tombstone. Field updates cannot revive a tombstoned
product; delete therefore wins against a concurrent update under this
candidate's conservative policy. Restoration is an explicit operation with a
new version. A restoration newer than the tombstone recreates the product and
also protects it from an older delete arriving later. Tombstones are retained
in simulator metadata for the lifetime of the replica. Category updates merge
the independently versioned `name`, `nameAr`, and `description` fields.

The baseline and candidate modes run the same fixed schedules in regression
tests. The baseline diverges for a same-field schedule whose delivery order
differs by target; the candidate converges to the deterministic winner.
Different-field edits, duplicate delivery, reordered delivery, and
three-replica partition/reconnection schedules converge in candidate mode.
Inventory adjustments remain additive operation deltas. Their convergence is
tested separately from overselling prevention: a converged negative quantity
is still a business-policy failure, not a transport or merge failure.

The scenarios in `src/backend/research/retailSimulator.test.ts` cover:

- concurrent product field edits;
- same-field and delete-versus-update order dependence;
- duplicate delivery and metadata accounting;
- explicit restoration and concurrent inventory adjustments;
- partition, reconnection, and queued delivery.

These tests establish simulator behavior and expose current limitations; they
do not establish production multi-replica retail convergence.

### Candidate assumptions and migration implications

The candidate assumes stable unique replica IDs, immutable operation IDs,
eventual delivery of every compatible operation, valid version metadata, and
retention of tombstones until no older operation can arrive. Its total-order
version is deterministic but is not a causal context or version vector, so it
cannot prove whether an operation happened before another one. The
delete-wins policy is intentionally conservative and may reject a legitimate
edit unless the client emits an explicit restore.

Before production adoption, operations need a versioned wire format and
backward-compatible replay/migration rules. Existing whole-record operations
cannot be safely interpreted as independent field writes without a defined
initial version. Production storage must persist field versions, tombstones,
restore metadata, and deduplication IDs atomically. The candidate must also be
tested across process restart and integrated with the authoritative API before
any production synchronization semantics are changed.

## Unsupported or unresolved semantics

- Product fields are currently whole-record writes at the retail API.
- Delete-versus-update and delete-versus-restore are not causally resolved.
- Category deletion and product references have no distributed conflict policy.
- Backend retail tombstones are not retained for deleted entities.
- Stock adjustments are not stored in the backend retail catalog.
- Production retail operations still carry no version vector, field versions,
  or causal context; candidate metadata exists only in the research simulator.
- No peer transport exchanges retail operations between independent backend
  processes.
- No authentication or tenant boundary protects a catalog.

## Production migration design

This section is a design only. It does not change the production retail API,
repository, persistence format, or synchronization behavior.

### Versioned operation schema

The production candidate wire format should be introduced as a new operation
version rather than changing the meaning of the existing whole-record
operations:

```ts
interface RetailVersion {
  logicalTime: number
  replicaId: string
  operationId: string
}

type VersionedRetailOperation =
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'product.patch'
      productId: string
      changes: Partial<Pick<Product,
        'name' | 'nameAr' | 'description' | 'descriptionAr' |
        'price' | 'availability' | 'lowStockThreshold' | 'categoryId'
      >>
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'product.delete' | 'product.restore'
      productId: string
      product?: Product
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'category.patch'
      categoryId: string
      changes: Partial<Pick<Category, 'name' | 'nameAr' | 'description'>>
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'inventory.adjust'
      productId: string
      delta: number
    }
```

The server must validate that `version.operationId === operationId` and
`version.replicaId === replicaId`, that the operation ID is non-empty and
unique, that patch fields are known and valid, and that a patch is not empty.
`product.restore` must include a complete product snapshot for the restored
record. `stock` and `updatedAt` are deliberately excluded from product field
patches: stock remains a separate inventory policy, and `updatedAt` is
transport metadata rather than a conflict field.

### Version generation and comparison

Each replica needs a stable, persisted identity generated during provisioning;
it must never be regenerated on restart or reused by another active replica.
The logical clock is persisted with the replica state. Before creating an
operation, the replica advances its clock to at least the current wall-clock
value and increments its logical component. On receipt, it merges the
received timestamp before generating another local operation. Wall-clock
time is not trusted as a sole ordering mechanism.

The deterministic total order is:

1. `logicalTime` ascending;
2. `replicaId` ascending using bytewise/ordinal comparison;
3. `operationId` ascending using bytewise/ordinal comparison.

For each independently editable field, the greatest version wins. The
comparison must be implemented once and shared by validation, merge, replay,
and tests; locale-sensitive ordering must not be used.

The simulator currently uses fixed numeric logical times and replica IDs
`A`, `B`, and `C`. Production must use opaque stable IDs and persist the clock
atomically with the operation/state write.

### Persistence and restart recovery

The versioned persistence record must be a new schema version, for example:

```ts
interface PersistedVersionedRetail {
  schemaVersion: 2
  replicaId: string
  clock: { wallClock: number; logicalCounter: number; nodeId: string }
  catalog: RetailCatalog
  products: Record<string, {
    fields: Product
    fieldVersions: Record<string, RetailVersion>
    tombstone?: RetailVersion
    restoredVersion?: RetailVersion
  }>
  categories: Record<string, {
    fields: Category
    fieldVersions: Record<string, RetailVersion>
  }>
  appliedOperationIds: string[]
  pendingOperations: VersionedRetailOperation[]
}
```

The durable write must atomically persist the catalog projection, field
versions, tombstones, restore metadata, operation deduplication IDs, pending
operations, and logical clock. A temporary-file-plus-rename strategy is
acceptable for the current file store, but the schema and all related fields
must be written as one record. Recovery must reject a partial or identity
mismatch rather than silently reconstructing metadata.

On restart, the runtime restores the same replica identity and clock, loads
all tombstones before accepting messages, and replays no operation already in
`appliedOperationIds`. A tombstone is retained until an explicitly defined
garbage-collection horizon proves that no older operation can arrive; the
first implementation should retain tombstones indefinitely.

### Delivery and conflict behavior

- Duplicate operation ID with identical content: return `duplicate` and make
  no state change.
- Duplicate operation ID with different content: reject as an operation-ID
  collision; never treat it as a harmless duplicate.
- Newer operation delivered before an older operation: apply the newer value;
  later stale delivery is recorded as processed but cannot overwrite it.
- Same-field concurrent writes: the greatest version wins deterministically.
- Different-field concurrent writes: both field registers survive.
- Delete versus update: a delete tombstone suppresses updates at or below its
  version. The candidate policy is conservative delete-wins for concurrent
  operations because equal logical times are ordered but not causal.
- Restoration: only an explicit restore with a version greater than the
  tombstone can recreate the product. Its restore version protects the
  restored entity from older deletes and updates.
- Category deletion and product/category referential behavior remain a
  separate policy decision; the candidate currently does not model category
  deletion semantics and production must not infer them.

### Backward compatibility and migration

Existing persisted records are schema version 1 and contain a whole-record
catalog plus applied operation IDs. They cannot be losslessly interpreted as
field-level history because they contain no field versions or tombstones.
Migration must therefore:

1. Preserve the existing replica identity and generic CRDT snapshot.
2. Initialize every existing live product/category field with one synthetic
   migration version, using a reserved operation ID such as
   `migration:<record-id>:<entity-id>` and a documented logical time below any
   newly generated operation.
3. Treat deleted entities absent from the v1 catalog as unknown, not as
   tombstoned; no delete history can be invented safely.
4. Preserve existing v1 pending whole-record operations in a compatibility
   queue. They must be applied as complete-record writes under one synthetic
   version, or be blocked until explicitly upgraded; silently splitting them
   into field patches is unsafe.
5. Keep v1 `product.upsert`, `product.delete`, `category.upsert`, and
   `category.delete` accepted by the API as compatibility operations during
   migration. They must be serialized through the authoritative compatibility
   path and must not be merged as if they carried candidate field metadata.
6. Persist a migration marker and schema version so restart cannot repeat
   synthetic initialization or generate duplicate migration operations.

A v2 client must not assume that a v1 acknowledgement establishes field-level
convergence. The API response should identify the accepted schema and
compatibility mode while both modes coexist.

### Files requiring modification during implementation

The smallest production implementation would touch:

- `src/domain/retailSync.ts`: add v2 operation/version types and response
  schema; retain v1 types.
- `src/backend/api/retail.ts`: validate v2 operations, compare versions,
  maintain field registers/tombstones, detect operation-ID collisions, and
  expose schema/compatibility status.
- `src/backend/api/server.ts`: route v2 validation and preserve v1 routes.
- `src/backend/persistence/ReplicaStore.ts`: integrate a revision-checked
  retail replacement boundary while preserving the existing V1 save path.
  File-backed mutations use a sidecar lock to serialize independent writers;
  crash recovery and filesystem durability remain unresolved.
- `src/repositories/Repository.ts` and `src/repositories/MockRepository.ts`:
  create versioned pending patches while preserving v1 pending replay.
- `src/services/backendApi.ts`: negotiate operation schema and surface
  duplicate/collision/stale results.
- `src/services/container.ts`: provision/load stable replica identity and
  logical clock.
- `src/backend/API.md`: document both compatibility modes and migration
  responses.
- `src/backend/api/retail.test.ts`, `src/services/backendApi.test.ts`, and
  repository tests: cover replay, migration, persistence, and API behavior.
- `src/backend/research/retailSimulator.test.ts`: make the fixed simulator
  schedules reusable as production acceptance fixtures rather than duplicating
  expected outcomes.

No peer-to-peer transport is required for this migration. An existing
operation submission endpoint or a later exchange endpoint can carry v2
operations, but transport is not part of this design milestone.

### Candidate/production mismatch

The candidate simulator is intentionally more capable than production in
several ways:

- Candidate operations already contain field-level versions; production
  operations are whole-record and unversioned.
- Candidate tombstones survive delivery reordering; the backend currently
  removes deleted records and does not retain retail tombstones.
- Candidate same-field resolution is deterministic; production resolution is
  request arrival order.
- Candidate category updates can merge fields; production category upserts
  replace whole records.
- Candidate inventory deltas are additive; production retail stock is not
  persisted through the catalog API.
- Candidate metadata is in-memory simulator state; production persistence
  currently stores only the v1 catalog, applied IDs, and generic snapshot.

Therefore, passing simulator schedules is an acceptance criterion for the
future v2 implementation, not evidence that the current backend converges.

### Acceptance gates and go/no-go

Implementation should not begin until the following decisions are approved:

- stable replica-ID provisioning and collision handling;
- logical-clock persistence and atomic update semantics;
- indefinite versus bounded tombstone retention;
- delete-wins behavior for concurrent operations;
- category deletion and referential-integrity policy;
- v1 pending-operation compatibility behavior;
- API response shape for duplicate, stale, and operation-ID collision results.

Once approved, implementation can proceed in this order:

1. Add v2 types, strict validators, version comparison, and pure merge tests.
2. Add schema-versioned persistence and v1 migration/restart tests.
3. Add the v2 backend runtime while retaining v1 compatibility mode.
4. Reuse every simulator schedule against the backend runtime, including
   duplicate, reorder, partition, three-replica, and inventory cases.
5. Add repository/API integration tests and failure-atomicity tests.
6. Only after all gates pass, consider transport or frontend opt-in.

**Recommendation: NO-GO for production implementation in this milestone.**
The candidate semantics are sufficiently specified for a follow-up
implementation, but the v1-to-v2 migration behavior, tombstone retention,
replica provisioning, category deletion policy, and API compatibility response
still require explicit approval and tests. No production convergence claim is
made.

## Recommended implementation sequence

1. Freeze this specification and add canonical operation/state fixtures.
2. Define the version/tombstone wire format and migration version.
3. Compare candidate outcomes against replayed production operations and
   define the versioned wire format.
4. Implement field-level product/category state independently of the current
   authoritative projection.
5. Implement delete/restore causal rules and tombstone retention.
6. Add a retail operation simulator with duplicate, reorder, partition, and
   three-replica schedules.
7. Add inventory delta tests and separate oversell/reservation policy tests.
8. Only then add transport between independent backend processes.
9. Keep the current authoritative API as a compatibility mode until migration
   and replay tests pass.
