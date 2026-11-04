# Distributed Synchronization Architecture Audit

**Audited baseline:** `fd8fb5a6249a2511c3611f007bfa48929bbcb6d5`
**Repository:** `lamarimohamed/syncdeskfrontenddevelopment`
**Audit date:** 2026-11-03
**Scope:** inspection and verification only; no application source or dependency changes were made.

## 1. Executive summary

The repository is a credible **research foundation**, but it is not yet a single
end-to-end CRDT application. It contains three materially different layers:

1. A browser-facing offline/demo synchronizer that is explicitly a localStorage
   queue with a price-only last-writer-wins merge rule.
2. A backend CRDT library and HTTP endpoint implementing generic LWW-register,
   OR-Set, PN-counter, HLC timestamping, state snapshots, duplicate message
   protection, and file persistence.
3. Deterministic in-process research simulators and experiment runners that
   exercise generic CRDT state and a more advanced retail candidate model.

The strongest reusable research asset is the backend generic CRDT plus its
deterministic simulator, not the current browser retail path. The current retail
HTTP endpoint applies whole-object upserts/deletes and records operation IDs, but
does not apply the versioned field-level merge semantics implemented in the
research simulator. Therefore, passing tests demonstrate local correctness of
the tested components, not production retail CRDT convergence.

**Overall assessment:** suitable as an implementation baseline for a Master's
project after the research model is made the single authoritative domain model
and a real multi-replica transport/process harness is added. It is not yet
suitable for claims about real network behavior, crash consistency across all
clients, bandwidth performance, or production retail convergence.

## 2. Verified architecture

```text
Browser React UI
  |
  v
Repository interface
  |
  +--> MockRepository
  |      +--> in-memory catalog/stock
  |      +--> browser localStorage persistence
  |      +--> enqueue ChangeDraft
  |      +--> applyRemote(price-only)
  |
  +--> SyncService
         |
         v
      SyncEngine
        +--> pending queue / activity / conflict records
        +--> simulated online/offline timers
        +--> optional BackendApiClient
        +--> localStorage state

Optional browser HTTP path
  BackendApiClient
    +--> POST /v1/retail/operations
    |      RetailDomainRuntime
    |        +--> whole-object catalog mutation
    |        +--> applied operation IDs
    |        +--> embedded generic ReplicaRuntime bookkeeping
    |
    +--> POST /v1/sync/messages
           ReliableSyncEndpoint
             +--> validate full ReplicaSnapshot
             +--> ReplicaRuntime.merge(snapshot)
             +--> applied message ID set
             +--> ReplicaStore/FileReplicaStore

Research-only backend path
  ReplicaRuntime
    +--> HLC + LWW register
    +--> OR-Set + tombstones/GC
    +--> PN-counter
    +--> snapshot/restore
  ReplicaSimulator / RetailReplicaSimulator
    +--> virtual time
    +--> delay, loss/drop, duplication, reordering, partitions
    +--> convergence and byte/accounting reports
  Experiment runners
    +--> deterministic matrices
    +--> JSONL/summary/manifest artifacts
```

The browser boundary is explicit in
[`SyncEngine.ts`](src/services/sync/SyncEngine.ts): its module documentation
states that it is a simulation and contains “no real CRDT” (lines 16-18).
The repository interface likewise describes `MockRepository` as in-memory plus
localStorage and a CRDT-backed replica as future work
([`Repository.ts`](src/repositories/Repository.ts), lines 14-18).

## 3. Synchronization pipeline

### Browser/local pipeline

1. A repository mutation updates local catalog state and creates a `ChangeDraft`
   ([`MockRepository.ts`](src/repositories/MockRepository.ts), lines 149-316).
2. `SyncEngine.enqueue` assigns a local ID, status, attempt count, timestamp,
   and estimated size, then persists the complete sync snapshot
   ([`SyncEngine.ts`](src/services/sync/SyncEngine.ts), lines 107-132 and
   349-378).
3. Offline state keeps the change pending. Reconnection transitions through
   `connecting`, then schedules a simulated sync
   ([`SyncEngine.ts`](src/services/sync/SyncEngine.ts), lines 139-174).
4. `finishSync` optionally sends pending retail operations to the backend,
   consumes an in-memory remote list, resolves only matching local/remote
   fields, clears the remote list, and marks local changes complete
   ([`SyncEngine.ts`](src/services/sync/SyncEngine.ts), lines 233-305).
5. `SyncService` adds a five-second timer for automatic retry after an error
   ([`syncService.ts`](src/services/syncService.ts), lines 6-7 and 59-66).

This is a user-facing offline queue, not operation-based CRDT replication.
The browser does not instantiate `ReplicaRuntime`, `ReliableSyncEndpoint`, or
`OrSet` for catalog state.

### Backend generic state pipeline

1. A sender creates a version-1 full-state `StateSyncMessage` containing a
   `ReplicaSnapshot` ([`protocol.ts`](src/backend/sync/protocol.ts), lines 5-28).
2. Messages are JSON encoded with a one-megabyte limit and validated for protocol,
   version, sender identity, and snapshot identity
   ([`protocol.ts`](src/backend/sync/protocol.ts), lines 54-91).
3. `ReliableSyncEndpoint.receive` rejects a repeated message ID; otherwise it
   restores the sender snapshot and merges it into the target runtime
   ([`reliability.ts`](src/backend/sync/reliability.ts), lines 64-103).
4. The HTTP server serializes writes through `requestChain`, persists the
   endpoint snapshot and applied message IDs, and returns an acknowledgement
   ([`server.ts`](src/backend/api/server.ts), lines 167-184 and 261-319).

This is full-state anti-entropy-like exchange, but there is no peer discovery,
subscription, outbound fanout, delta protocol, or transport-level session.

### Retail backend pipeline

`BackendApiClient.syncChanges` sends retail operations first, then constructs a
new generic runtime containing tags for the pending browser changes and sends a
separate full-state message ([`backendApi.ts`](src/services/backendApi.ts),
lines 103-123). The retail endpoint validates legacy `product.upsert`,
`product.delete`, `category.upsert`, and `category.delete` operations and applies
them in request order ([`retail.ts`](src/backend/api/retail.ts), lines 50-112).
It does not call `validateVersionedRetailOperation` or use the candidate retail
merge algorithm.

## 4. CRDT implementation inventory

| Mechanism | Implementation | Actual guarantee | Status |
|---|---|---|---|
| Replica identity | `replicaId` required by `ReplicaRuntime`, HLC, OR-Set, PN-counter | Distinguishes writers in tested runtime instances | Implemented in generic runtime |
| State representation | `ReplicaSnapshot` contains clock, register, OR-Set, counter | Serializable full-state snapshot | Implemented |
| Operation representation | Generic wire messages carry snapshots, not individual CRDT ops; retail research ops carry operation IDs and optional versions | Message identity and state transfer; no generic causal op log | Partial |
| Causal metadata | HLC timestamps; OR-Set remove vector and observation matrix | Timestamp ordering and tested causal-stability evidence for OR-Set GC | Partial; no version vector for all operations |
| Version vectors | None for the generic register/counter; OR-Set has remove-event knowledge vectors only | No general causal completeness test or delivery frontier | Missing |
| Concurrent updates | LWW register chooses max HLC; OR-Set preserves concurrent adds; PN-counter sums per-replica increments/decrements | Deterministic primitive-specific merge semantics | Implemented/tested for primitives |
| Merge semantics | LWW max; OR-Set union plus tombstones; PN-counter component-wise max | Idempotent state joins for those primitives | Implemented/tested |
| Idempotency | Endpoint retains applied message IDs; retail runtime retains operation IDs; CRDT state merges are set/max based | Duplicate full message/retail operation is ignored where the ID set is used | Implemented, but endpoint IDs are unbounded |
| Tombstones | OR-Set removed tags with optional `removedBy`; retail catalog deletion has no CRDT tombstone | Safe OR-Set remove visibility; no equivalent production retail deletion semantics | Partial |
| Garbage collection | OR-Set causal-stability GC with static membership requirement | Collects covered tombstones after every member is observed; tests cover delayed replicas/re-adds/restart | Implemented in generic OR-Set only |
| Restart/recovery | `ReplicaRuntime.fromJSON`; file-backed backend persistence; browser localStorage restoration | Backend snapshot and duplicate-ID recovery is tested | Partial across system |

### Important correctness observations

- HLC is a deterministic ordering mechanism, not a version vector. It does not
  prove that a receiver has seen all causally prior operations.
- `ReplicaRuntime.merge` merges the register, OR-Set, and PN-counter, but the
  merged clock is not used as a delivery condition
  ([`replica.ts`](src/backend/crdt/replica.ts), lines 68-75).
- The generic endpoint's duplicate guard is message-ID based and intentionally
  retained for the endpoint lifetime; it is not CRDT tombstone metadata
  ([`reliability.ts`](src/backend/sync/reliability.ts), lines 52-62).
- The generic simulator delivers snapshots directly with `target.merge(...)`;
  it does not use `ReliableSyncEndpoint` and therefore does not exercise endpoint
  duplicate-ID persistence ([`simulator.ts`](src/backend/sync/simulator.ts),
  lines 231-258).
- The retail candidate simulator does implement field-level version comparison
  and deterministic UTF-8 tie-breaking, but this is research simulator logic,
  not the backend retail runtime ([`retailSimulator.ts`](src/backend/research/retailSimulator.ts),
  lines 352-438; [`retail.ts`](src/backend/api/retail.ts), lines 61-112).

## 5. Correctness guarantees and limitations

### Supported by source and tests

- HLC timestamps advance monotonically, observe remote timestamps, and resolve
  equal timestamp ties by node ID ([`clock.ts`](src/backend/crdt/clock.ts),
  lines 17-114; `clock.test.ts`).
- LWW register merge is deterministic by HLC comparison
  ([`lwwRegister.ts`](src/backend/crdt/lwwRegister.ts), lines 39-52).
- PN-counter merge is component-wise maximum, giving duplicate/order-insensitive
  counter state for valid deltas ([`pnCounter.ts`](src/backend/crdt/pnCounter.ts),
  lines 36-58).
- OR-Set concurrent re-adds survive removal of older tags, and causal-stable
  tombstones can be collected without resurrection under the documented static
  membership assumption ([`orSet.ts`](src/backend/crdt/orSet.ts), lines 161-236;
  `orSet.gc.test.ts`).
- HTTP duplicate messages are acknowledged as duplicates, writes are serialized,
  persistence failure does not publish an in-memory candidate, and file-backed
  state plus duplicate IDs survive backend restart
  ([`server.test.ts`](src/backend/api/server.test.ts), lines 64-243).
- The candidate retail simulator converges on same-field conflicts under its
  explicit version comparator, while the baseline order-sensitive model does not
  ([`retailSimulator.test.ts`](src/backend/research/retailSimulator.test.ts),
  lines 83-100).

### Not established by this repository

- Exactly-once delivery: duplicate application is suppressed at selected
  endpoints, but network delivery itself remains at-least-once/unspecified.
- End-to-end retail convergence through the HTTP API: the endpoint applies
  request-order whole-object mutations and does not merge versioned retail
  operations.
- Causal consistency: no general version-vector protocol or causal delivery
  barrier exists.
- Crash consistency for browser data: localStorage writes are best-effort and
  silently fall back to memory when unavailable
  ([`storage.ts`](src/lib/storage.ts), lines 16-41).
- Security, authentication, authorization, adversarial replica identity, or
  Byzantine behavior.
- Real network performance, packet loss, TCP retransmission, bandwidth, or
  Wireshark/GNS3 behavior. The repository's own guide says the simulator is
  virtual-time and in-process ([`NETWORK_VALIDATION_GUIDE.md`](src/backend/NETWORK_VALIDATION_GUIDE.md),
  lines 1-12).

## 6. Offline behavior assessment

| Requirement | Evidence | Assessment |
|---|---|---|
| Local persistence | Browser `localStorage` for sync and catalog state; session storage for session-scoped data | Implemented, but not IndexedDB and not transactional |
| Offline writes | Repository mutates local data and queues pending changes while offline | Implemented and tested in `offlineFlow.test.ts` |
| Reconnection | Browser `online/offline` events call `goOffline`/`goOnline`; engine transitions through connecting and sync | Implemented for the demo path |
| Retries | Error state retains pending changes; `SyncService` schedules a five-second retry; generic sender has bounded retry helper | Partial; frontend retry is timer-based and generic retry is not wired into browser transport |
| Duplicate synchronization | Backend message IDs and retail operation IDs are retained; simulator operation IDs deduplicate | Implemented in selected paths, not universal |
| Data durability | Backend `FileReplicaStore` uses temp-file rename and lock; browser persistence is best-effort | Backend partial/stronger; browser durability unverified |
| Browser/process restart | SyncEngine reads persisted state on construction; backend restart is explicitly tested | Backend verified; browser restart path exists but no dedicated restart test was found |
| Service worker | Production application-shell service worker exists | Offline asset availability only; it is not synchronization durability |

The frontend offline test proves local queueing and simulated reconnection, not
remote replica exchange. Its conflict test explicitly expects a last-writer-wins
result ([`offlineFlow.test.ts`](src/services/sync/offlineFlow.test.ts),
lines 30-75).

## 7. Experimental readiness matrix

| Capability | Current evidence | Readiness |
|---|---|---|
| Multiple independent replicas | Generic simulator accepts replica IDs; retail simulator fixes A/B/C; backend can be started with distinct replica IDs | Ready in-process; not process-level |
| Deterministic concurrent workloads | Seeded PRNG, virtual time, fixed operation schedules, canonical hashes | Ready for functional experiments |
| Network partitions | Generic and retail simulators support replica/link partitions | Ready as a simulator abstraction |
| Delay/jitter | Virtual message delay exists | Ready for bounded simulated delay; no physical timing |
| Loss/drop | Generic simulator and matrix use `dropEvery` | Ready for scheduled loss; no retransmission experiment in the main runner |
| Duplication/reordering | Retail simulator and endpoint tests cover duplicates; queue ordering is deterministic | Ready in simulator; generic experiment runner does not measure acks/retries |
| Bandwidth restriction | Payload byte counters exist | Not ready: no bandwidth cap, rate shaping, or transport queue model |
| Replica failures/restarts | Simulator has in-memory `restart`; backend file restart is tested | Partial: no crash timing, torn write, process kill, or recovery workload |
| Automated convergence | Generic semantic convergence and retail visible/protocol convergence are asserted | Ready for modeled state |
| Metadata/bandwidth measurement | State, metadata, tombstone, and JSON payload sizes exist | Partial: acknowledgements/retries are zero in generic runner; baseline transport bytes are null |
| Reproducible execution | Matrix runners, seeds, JSONL, summaries, manifests, preserved `.tmp` artifacts | Ready for in-process replication studies |
| Real-network experiments | Documentation explicitly says no socket transport/GNS3/Wireshark validation | Missing |

Existing artifacts demonstrate useful pilot evidence but must be interpreted
within these boundaries. For example, the preserved retail summary reports
candidate convergence for same-field and partition-reconnect scenarios while
the baseline fails same-field convergence; this is simulator evidence, not
production API evidence (`.tmp/retail-pilot-20261019-5h/summary.json`).
The OR-Set GC artifact reports five runs per scenario with zero resurrection
runs, but it is likewise an in-process experiment
(`.tmp/gc-orset-20261028/summary.json`).

## 8. Baseline readiness

### Client-server Last-Write-Wins

An in-process baseline exists in
[`clientServerLww.ts`](src/backend/baseline/clientServerLww.ts). It has a
server-authoritative register, disconnected-client buffers, deterministic HLC
ordering, and duplicate operation IDs. `runComparableScenario` replays a
shared deterministic workload against the generic CRDT simulator and this
baseline ([`comparison.ts`](src/backend/baseline/comparison.ts), lines 48-130).

It is ready as a **functional semantic baseline**, but not as a transport or
bandwidth baseline: the comparison runner intentionally records baseline byte
fields as `null` ([`experimentRunner.ts`](src/backend/research/experimentRunner.ts),
lines 373-410).

### Yjs

Yjs is absent from `package.json` and no Yjs adapter, document schema, provider,
transport, or benchmark exists. Yjs comparison is therefore **not ready**.
Adding it is outside this audit and was not attempted.

### Custom synchronization implementation

The generic CRDT primitives and simulator are ready for a first custom-system
study. The browser retail implementation is not equivalent to that system:
the browser sends legacy retail operations and a newly constructed tag snapshot,
while the research candidate uses per-field versions. A defensible comparison
must choose one canonical custom protocol and run it through the same transport,
workload, failure, and measurement harness as the baselines.

## 9. Missing components and critical technical risks

### Missing components

1. A canonical versioned retail operation protocol shared by browser, backend,
   simulator, and persistence.
2. A general causal metadata design (version vectors, dotted version vectors,
   or a formally justified alternative) for all replicated domain operations.
3. A real multi-process peer/server transport with outbound exchange, retry,
   acknowledgement, duplicate handling, and reconnection semantics.
4. A durable per-replica operation log or equivalent delta/state anti-entropy
   protocol; current messages are full snapshots.
5. A retail deletion/restore tombstone model and GC policy.
6. A Yjs adapter and common benchmark interface.
7. A transport emulator with bandwidth/rate limits, loss/retry accounting,
   packet/message overhead, and failure injection.
8. Crash/restart experiments across replicas, including interrupted persistence.
9. A formal invariant suite covering convergence, inflation/idempotency,
   remove-wins/add-wins choices, and application business invariants.
10. A CLI entry point that runs the complete matrix reproducibly without a
    temporary test harness.

### Critical risks

- **Semantic split:** the production retail endpoint is not the research
  candidate model. Results from one cannot be presented as results from the
  other.
- **Whole-state transfer cost:** every generic synchronization message contains
  a complete snapshot, causing metadata and payload growth and making bandwidth
  comparisons unrepresentative of a mature delta protocol.
- **Unbounded deduplication:** endpoint applied-message IDs and retail operation
  IDs are retained indefinitely; GC of these identifiers is not designed.
- **Static-membership GC assumption:** OR-Set collection is unsafe to generalize
  beyond the documented membership/evidence model.
- **Browser storage weakness:** localStorage has no transaction protocol, quota
  strategy, or durable write acknowledgement; fallback memory can lose state.
- **Incomplete retry semantics:** the helper `ReliableSyncSender` is not wired
  into the HTTP client, and the main experiment runner reports zero
  acknowledgement/retry bytes.
- **Measurement comparability:** baseline byte fields are null and simulator
  bytes exclude transport framing and real retransmissions.
- **Identity trust:** replica IDs are caller-provided strings; no authenticated
  identity or anti-replay policy exists.

## 10. Prioritized implementation roadmap

### P0 — Establish a valid research system boundary

1. Select the custom CRDT model and formally define per-entity semantics:
   field-level LWW, OR-Set membership, PN-counter inventory, delete/restore,
   and conflict policy.
2. Replace the legacy retail operation path with the versioned protocol end to
   end, including validation, causal metadata, merge, persistence, and
   browser serialization.
3. Add invariant/property tests for idempotency, commutativity, associativity,
   convergence under arbitrary delivery order, and restart recovery.
4. Explicitly document which claims apply to the generic primitives, retail
   candidate simulator, backend runtime, and browser application.

### P1 — Make experiments transport- and failure-valid

5. Implement a shared transport interface used by custom CRDT and LWW baseline.
6. Add process-independent replicas, outbound synchronization, bounded retries,
   acknowledgements, duplicate/reorder handling, and durable operation/state
   recovery.
7. Add deterministic bandwidth/rate limits and message accounting that includes
   application payload, acknowledgement, retry, and transport framing separately.
8. Add crash/restart and persistence-failure scenarios, retaining failed and
   non-converged runs.

### P2 — Add comparison systems

9. Implement the client-server LWW baseline through the same transport and
   measurement interface.
10. Add a Yjs adapter/provider and define equivalent workload/state projections.
11. Ensure all three systems receive identical resolved workloads, partitions,
   seeds, observation windows, and failure schedules.

### P3 — Validate externally and prepare the thesis evidence

12. Run multi-process tests, then controlled network emulation/GNS3/Wireshark
   experiments as described in [`NETWORK_VALIDATION_GUIDE.md`](src/backend/NETWORK_VALIDATION_GUIDE.md).
13. Report convergence, convergence time, payload/metadata growth, retry cost,
   tombstone cost, failure recovery, and business-invariant violations with
   confidence intervals over multiple seeds.
14. Preserve source revision, configuration, raw JSONL, logs, captures, and
   generated summaries for every experiment.

## 11. Verification record

Executed against the committed baseline `fd8fb5a`:

- `npm run typecheck` — **passed**.
- `npm test -- --run` — **passed: 29 test files, 186 tests**.
- `npm run build` — **passed**; Vite transformed 2,092 modules.

The test and build commands emitted non-failing Vite warnings about future
`configLoader: 'native'` compatibility (`__dirname` and a JSON import without
attributes). These warnings do not invalidate the audit results but should be
resolved before a future tooling upgrade.

No application source code, dependency manifest, or dependency lockfile was
modified for this audit.
