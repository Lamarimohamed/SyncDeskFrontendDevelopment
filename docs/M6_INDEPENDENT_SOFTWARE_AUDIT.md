# Milestone 6 — Independent Software Audit (SyncDesk)

**Audit Date:** 2026-11-20  
**Auditor Role:** Senior Distributed-Systems Engineer, Software Architect & Technical Lead  
**Audit Mode:** Independent, Read-Only Software Audit (No Application Source Modifications)

---

## 1. Actual Repository State & Git Provenance

### 1.1 Branch and Commit Divergence

Independent inspection of local and remote Git references revealed a critical divergence between the active `main` branch and the reported Milestone 5 commit (`eedd28efc9e00c88a3edd19c505914a4f8794782`):

| Reference | Commit SHA | Summary | Status |
|---|---|---|---|
| `HEAD` / `main` / `origin/main` | `e822203470e5e7d58792d060b0ea32d179c4d691` | `Merge pull request #1 from Lamarimohamed/wip/milestone-2` (merges `cbb6b48`) | **Checked out locally**; contains only up to Milestone 2 (`WIP: Milestone 2 escrow stock (unaudited)`) |
| `origin/wip/milestone-2` | `eedd28efc9e00c88a3edd19c505914a4f8794782` | `docs: record M5 acceptance results` | **Unmerged remote branch**; 11 commits ahead of `main` (`cbb6b48..eedd28e`) |

### 1.2 Unmerged Commits on `origin/wip/milestone-2` (`main..origin/wip/milestone-2`)

Pull Request `#1` was merged into `main` at commit `cbb6b48`. Subsequently, 11 additional commits implementing M2.1 through M5 were pushed to `origin/wip/milestone-2` without being merged into `main`:

1. `ad58965` — `Persist browser installation identity`
2. `aa06861` — `Implement backend bootstrap and stock allocation`
3. `294212c` — `Enforce category referential integrity`
4. `08aaf24` — `Define deterministic catalog conflict semantics`
5. `183bc38` — `Make stock operation outcomes explicit`
6. `29e02d2` — `Test multi-replica synchronization integration`
7. `8ebe9cf` — `Validate persistence and recovery`
8. `c6fbb58` — `docs: audit end-to-end MVP workflows`
9. `2aeb64b` — `feat: expose synchronization stock outcomes`
10. `20e1e91` — `test: validate end-to-end retail workflows`
11. `eedd28e` — `docs: record M5 acceptance results`

Those 11 commits modify 27 files (`+1,314 / -46` lines). Because the user handover explicitly targets the M5 baseline at `eedd28efc9e00c88a3edd19c505914a4f8794782` while requiring zero application source modifications during M6, this audit inspects and evaluates **both** the checked-out `main` tree (`e822203`) and the full M5 tree on `origin/wip/milestone-2` (`eedd28e`).

### 1.3 Working Tree and Validation Execution

- **Working tree status:** Clean (`git status` reports nothing to commit prior to creating this report).
- **Dependencies:** Installed deterministically via `pnpm install --frozen-lockfile` (128 packages).
- **Validation commands executed on `main` (`e822203`):**
  - `npm test` (`vitest run`): **32 test files passed, 214 tests passed**.
  - `npm run typecheck` (`tsc --noEmit`): **passed (0 errors)**.
  - `npm run build` (`vite build`): **passed (2,086 modules transformed)**.
  - `git diff --check`: **passed (no whitespace or merge marker errors)**.

---

## 2. Actual System Architecture

SyncDesk currently consists of **three distinct architectural paths** coexisting in the same repository:

```
+-----------------------------------------------------------------------------------+
| 1. BROWSER / FRONTEND APPLICATION PATH                                            |
|                                                                                   |
|  React UI Pages (Products, Categories, Stock, Sync, Devices, Settings)            |
|        |                                                                          |
|        v                                                                          |
|  MockRepository (src/repositories/MockRepository.ts)                              |
|    - Local state persisted in localStorage ('syncdesk.data.v1')                   |
|    - Enqueues ChangeDraft with RetailOperation                                    |
|    - Applies incoming VersionedRetailOperation (v2) or simulated price LWW        |
|    - Maintains per-product EscrowedStock ledger                                   |
|        |                                                                          |
|        v                                                                          |
|  SyncEngine (src/services/sync/SyncEngine.ts)                                     |
|    - Persists queue, cursor, logicalTime, appliedOperationIds ('syncdesk.sync.v1')|
|    - Persistent installation identity ('syncdesk.installation.v1' in M5)          |
|    - Converts RetailOperation -> VersionedRetailOperation (schemaVersion: 2)      |
|    - Push/Pull via BackendApiClient when VITE_BACKEND_URL is configured           |
+-----------------------------------------------------------------------------------+
                                         |
                                         | HTTP (optional; disabled if no env URL)
                                         v
+-----------------------------------------------------------------------------------+
| 2. BACKEND HTTP SYNCHRONIZATION SERVER (src/backend/api/server.ts)                |
|                                                                                   |
|  A. Server-Mediated Versioned Retail Log (Active v2 Path):                        |
|     - POST /v1/bootstrap & GET /v1/bootstrap (M5 registration & stock allocation) |
|     - POST /v1/sync/operations (validates, appends to DurableOperationLog)        |
|     - GET  /v1/sync/operations?after=<cursor>&limit=<n> (paginated log pull)      |
|     - GET  /v1/sync/catalog (returns VersionedRetailRuntime projection)           |
|     - Backed by VersionedRetailRuntime + DurableOperationLog + ReplicaStore       |
|                                                                                   |
|  B. Legacy Whole-Record Retail Endpoint (v1 Compatibility Path):                  |
|     - POST /v1/retail/operations (routes v2 to log, or v1 to RetailDomainRuntime) |
|     - GET  /v1/retail/catalog & GET /v1/retail/state                              |
|                                                                                   |
|  C. Generic Full-State CRDT Endpoint (Isolated from Retail Catalog):              |
|     - POST /v1/sync/messages & GET /v1/replica                                    |
|     - ReliableSyncEndpoint + ReplicaRuntime<string> (1 LWW, 1 OR-Set, 1 Counter)  |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
| 3. IN-PROCESS RESEARCH SIMULATORS & BENCHMARK RUNNERS (src/backend/research/)     |
|                                                                                   |
|  - ReplicaSimulator (src/backend/sync/simulator.ts): generic CRDT state exchange  |
|  - RetailReplicaSimulator (src/backend/research/retailSimulator.ts): 3-replica    |
|    baseline vs. candidate versioned retail conflict simulator                     |
|  - ClientServerLwwBaseline (src/backend/baseline/clientServerLww.ts)              |
|  - Experiment runners: experimentRunner.ts, retailExperimentRunner.ts,            |
|    gcExperiment.ts, and scripts/run-distributed-experiment.mjs                    |
+-----------------------------------------------------------------------------------+
```

### Key Architectural Findings

1. **Server-Mediated Topology Only:** There is no peer-to-peer (P2P), LAN discovery, gossip, or direct replica-to-replica transport. All multi-replica synchronization in the application path is mediated by a central HTTP server hosting an append-only `DurableOperationLog`.
2. **Backend Optionality in Browser:** In [`src/services/container.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/container.ts#L16), `backendClient` is instantiated only if `VITE_BACKEND_URL` (`env.backendUrl`) is set. When unset, `SyncEngine` runs purely against `localStorage` with simulated timers and never contacts a server.
3. **Simulated UI Surfaces:**
   - [`MockRepository.devices()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L648-L688) returns hard-coded `PEER_SEEDS` (`Kitchen display`, `Manager laptop`, `Waiter handheld #1`, ` Patio bar terminal`). It does not reflect registered replicas from `/v1/bootstrap`.
   - [`MockRepository.stats()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L639-L646) computes `metadataBytes` using a synthetic formula (`12_000 + 64 * entities + 48 * tombstones`).
   - [`SyncEngine.finishSync()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/sync/SyncEngine.ts#L318-L356) calculates `bytesReceived` from the simulated `this.remote` queue (`180 + received * 120`), completely ignoring bytes pulled from `/v1/sync/operations`.

---

## 3. CRDT Correctness Audit

### 3.1 Generic CRDT Primitives (`src/backend/crdt/`)

The standalone generic primitives are clean, well-structured, and mathematically sound within their modeled assumptions:
- **Hybrid Logical Clock ([`clock.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/crdt/clock.ts)):** Monotonically advances wall/logical components and breaks ties deterministically by `nodeId`.
- **LWW-Register ([`lwwRegister.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/crdt/lwwRegister.ts)):** Commutative, associative, and idempotent state join ordered by HLC timestamp.
- **PN-Counter ([`pnCounter.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/crdt/pnCounter.ts)):** Per-replica increment/decrement vector merged via component-wise maximum (`Math.max`).
- **OR-Set with Causal-Stability GC ([`orSet.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/crdt/orSet.ts)):** Add-wins observed-remove set with unique `(replicaId, counter)` tags, remove knowledge vectors, and observation-matrix garbage collection under static membership.

> [!IMPORTANT]
> The generic primitives in `src/backend/crdt/` are **not used** by `VersionedRetailRuntime` or `MockRepository` to manage the retail catalog. Instead, the retail system implements a separate operation-based/state-versioned domain model in [`src/domain/retailSync.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/retailSync.ts), [`src/backend/sync/versionedRetailRuntime.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts), and [`src/repositories/MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts).

### 3.2 Retail Domain CRDT Correctness & Bugs Identified

Inspection of the versioned retail synchronization logic (`schemaVersion: 2`) revealed **five concrete correctness defects** where state convergence or commutativity is violated:

#### Defect CRDT-1 (P0): `product.delete` vs. `product.patch` Delivery-Order Non-Commutativity (Broken Delete-Wins)
- **Location:** [`VersionedRetailRuntime.apply()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts#L50-L64) and [`MockRepository.applyVersionedOperation()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L497-L519).
- **Mechanism:**
  - When `product.patch` arrives, it checks `if (record && !record.tombstone)`. If any tombstone exists, the patch is ignored regardless of whether `patch.version > record.tombstone`.
  - When `product.delete` arrives, it checks `(!record.tombstone || version > record.tombstone) && (!record.restoredVersion || version > record.restoredVersion)`, and sets `record.tombstone = version` **without comparing against `record.fieldVersions`**.
  - However, if a concurrent or newer `product.patch` ($v_2$) and an older `product.delete` ($v_1$, with $v_1 < v_2$) are exchanged:
    -Both orders result in a tombstone, **except** if `product.patch` ($v_2$) is applied before `product.delete` ($v_1$), `record.fields` is mutated by $v_2$ before being hidden by $v_1$, whereas if `product.delete` ($v_1$) arrives first, $v_2$ is skipped. Their internal `snapshot()` states (`record.fields` and `record.fieldVersions`) **diverge** depending on arrival order.
  - Furthermore, if a product is deleted at $v_2$, then restored at $v_3$ ($v_3 > v_2$):
    - In `VersionedRetailRuntime`, `product.restore` overwrites the `ProductRecord` and clears `tombstone`.
    - **In `MockRepository` (lines 485–496), `product.restore` NEVER clears `metadata.productTombstones[operation.productId]`!**
    - Consequently, in `MockRepository`, after a product is deleted and restored, `metadata.productTombstones[productId]` remains truthy forever, and line 508 (`if (product && !metadata.productTombstones[operation.productId])`) **permanently drops every subsequent remote `product.patch` on that restored product!**

#### Defect CRDT-2 (P0): Category Resurrection & Stale-Delete Bug (`category.patch` vs. `category.delete`)
- **Location:** [`VersionedRetailRuntime.apply()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts#L78-L100) and [`MockRepository.applyVersionedOperation()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L520-L545).
- **Mechanism:**
  1. In `VersionedRetailRuntime`: when `category.patch` has `version > record.tombstone`, it updates `record.fields` (lines 91–97), **but never clears `record.tombstone`**, so `catalog()` (which filters `!record.tombstone`) continues to hide the category forever.
  2. In `VersionedRetailRuntime`: when `category.delete` arrives (lines 98–100), it checks `(!record.tombstone || compareRetailVersions(version, record.tombstone) > 0)` **without checking whether `record.fieldVersions` has a newer version**! Thus, an older `category.delete` ($v_1$) arriving after a newer `category.patch` ($v_2$) tombstones the category.
  3. In `MockRepository`: `category.delete` (line 544) physically removes the category from `this.data.categories` (`this.data.categories.filter(...)`). If a newer `category.patch` arrives later, `this.data.categories.find(...)` returns `undefined`, so it recreated the category without checking `metadata.categoryTombstones`! Hence an **older** `category.patch` arriving after a **newer** `category.delete` resurrects the deleted category in `MockRepository`!

#### Defect CRDT-3 (P0): Context-Sensitive Referential Integrity Causes Replica Divergence
- **Location:** `VersionedRetailRuntime.validateDomainOperation()` (added in M5 commit `294212c`) and `MockRepository.applyVersionedOperation()` (M5 commit `294212c`, lines 545–547).
- **Mechanism:**
  - M5 added a rule in `MockRepository`: when applying a remote `category.delete`, if `this.data.products.some(p => p.categoryId === operation.categoryId)` is true locally, `applyVersionedOperation` returns early (silently dropping the remote `category.delete`), **even though line 443 already added `operation.operationId` to `metadata.applied` and `SyncEngine` already added it to `appliedOperationIds` and advanced `this.cursor`!**
  - If Replica A has an unsynced local product in Category C (or receives operations in a different batch order) when it pulls `category.delete(C)` from the server, Replica A **permanently ignores `category.delete(C)`** and never retries it (because its `operationId` is marked applied and the cursor has passed it). Replica A and the Server permanently diverge on whether Category C exists.

#### Defect CRDT-4 (P1): Whole-Entity Category Patch Overwrites Concurrent Different-Field Category Edits
- **Location:** [`MockRepository.updateCategory()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L307-L326) and [`SyncEngine.toVersionedOperation()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/sync/SyncEngine.ts#L463-L473).
- **Mechanism:** When a user edits only a category's `description`, `MockRepository.updateCategory` emits `category.upsert` with the entire `Category` object, and `SyncEngine.toVersionedOperation` converts it into a `category.patch` containing `{ name, nameAr, description }`—stamping all three fields with the new version. A concurrent edit to `name` on another replica with a lower timestamp is overwritten by the stale `name` included in the description update.

#### Defect CRDT-5 (P2): Dead Code bug on `main` (Fixed on `origin/wip/milestone-2`)
- **Location:** [`src/domain/retailSync.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/retailSync.ts#L299-L319) on `main`.
- **Mechanism:** On `main`, `if (operation.kind === 'category.delete')` (lines 313–318) is placed *inside* the `if (operation.kind === 'category.patch')` block after a `return` statement, making `category.delete` validation unreachable dead code and causing `validateVersionedRetailOperation` to throw `kind is invalid` for every `category.delete` operation. (Note: Commit `294212c` on `origin/wip/milestone-2` fixed the brace placement).

---

## 4. Replica Synchronization Correctness Audit

### 4.1 Push/Pull Protocol Mechanics
- **Transport:** HTTP `POST /v1/sync/operations` (batch push up to 100 ops) and `GET /v1/sync/operations?after=<cursor>&limit=<n>` (paginated pull, 1..500 ops).
- **Cursor Management:** `SyncEngine.pullVersionedOperations()` pulls pages sequentially, applies operations not in `this.appliedOperationIds`, updates `this.logicalTime = Math.max(this.logicalTime, op.version.logicalTime)`, advances `this.cursor = page.nextCursor`, and persists state after each page.

### 4.2 Synchronization Bugs & Gaps Identified

#### Defect SYNC-1 (P0): Race Condition Between Bootstrap Hydration and Initial Sync
- **Location:** [`src/services/container.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/container.ts#L37-L47) (and on `origin/wip/milestone-2`).
- **Mechanism:** `engine.start()` is called synchronously on line 37, which schedules `runSync()`, while `backendClient.registerReplica(engine.replicaId).then(bootstrap => mockRepository.hydrateCatalog(...))` is launched asynchronously as a floating promise (`void ...`).
- Moreover, when `hydrateCatalog` runs on a fresh browser replica whose local storage was seeded with `buildSeed(Date.now())`, `hydrateCatalog` replaces `this.data.products` and `this.data.categories` with the server's catalog, **without updating `this.cursor` to the server's current log position** and **without initializing `this.data.versioned` field versions**!
- Even worse: if the backend server starts with an **empty** catalog (which is the default in `createBackendServer` unless seeded!), `hydrateCatalog` sees `remoteProductIds = new Set()` (empty), concludes all 16 local seeded products were "remotely deleted", and **wipes out the entire local seed catalog into `this.data.tombstones`**!

#### Defect SYNC-2 (P0): Non-Atomic Dual Storage Persistence (`syncdesk.data.v1` vs. `syncdesk.sync.v1`)
- **Location:** [`MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L427-L438) and [`SyncEngine.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/sync/SyncEngine.ts#L433-L449).
- **Mechanism:** Catalog state (`syncdesk.data.v1`) and synchronization state (`syncdesk.sync.v1`) are written in separate `localStorage.setItem` calls. During `write()`, `this.engine.enqueue()` persists `syncdesk.sync.v1` *before* `MockRepository.write()` finishes and calls `this.commit()` to persist `syncdesk.data.v1`. If the tab closes or crashes between those calls (or if `writeJson` silently catches a quota error in `storage.ts`), `SyncEngine` and `MockRepository` have inconsistent applied operation sets and state.

#### Defect SYNC-3 (P1): Rejection of a Single Operation Fails Entire Push Batch Blocking Subsequent Operations
- **Location:** `server.ts` (`POST /v1/sync/operations`) and `SyncEngine.finishSync()`.
- **Mechanism:** In `server.ts`, `body.operations.map(...)` validates and appends each operation sequentially. If operation #3 of 5 throws an error (e.g., `category.delete` on a referenced category), the server catches the exception at the batch level and returns HTTP `400` **after operations #1 and #2 were already durably appended and applied**!
- Furthermore, `SyncEngine` receives the HTTP 400 error, marks **all 5 operations** as `failed`, and has **no mechanism to remove or quarantine a permanently rejected operation** (because `discardable` is `false` for `category.delete`, `product.create`, `stock.adjust`, etc.). That single rejected `category.delete` permanently wedges the replica's push queue on every subsequent sync attempt!

#### Defect SYNC-4 (P1): Clock Initialized from `Date.now()` in `MockRepository` vs. Counter in `SyncEngine`
- **Location:** [`MockRepository.recordAdjustment()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L586) vs. [`SyncEngine.toVersionedOperation()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/sync/SyncEngine.ts#L453).
- **Mechanism:** When recording a local stock adjustment, `MockRepository.recordAdjustment` applies the operation to its local `EscrowedStock` using `version: { logicalTime: Date.now(), ... }` (e.g. `~1795188600000`), and then passes `stockOperation` (without version) to `this.enqueue()`. `SyncEngine.toVersionedOperation()` then assigns `version: { logicalTime: ++this.logicalTime, ... }` (e.g., `1`, `2`, `3`).
- As a result, `MockRepository`'s local `this.data.stocks[productId]` stores the operation with `logicalTime = Date.now()`, whereas the server and all other replicas receive the operation with `logicalTime = 1`! Since `EscrowedStock` sorts operations by `version` (`logicalTime`), the originating replica and remote replicas have **different `RetailVersion` timestamps for the exact same stock operation**!

---

## 5. Stock Escrow Correctness Audit

Milestone 2 and Milestone 5 introduced `EscrowedStock` ([`src/domain/stock.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/stock.ts)), a token-based escrow ledger intended to prevent negative inventory (overselling) while offline.

### 5.1 Critical Bugs in `EscrowedStock` and Allocation

#### Defect STOCK-1 (P0): `EscrowedStock.allocate()` Fails Unless a `restock` Operation Exists in the Log
- **Location:** `EscrowedStock.recompute()` in `src/domain/stock.ts` on `origin/wip/milestone-2` (lines 177–221).
- **Mechanism:** Look closely at how `this.state.allocations` is applied in `recompute()` on `origin/wip/milestone-2`:
  ```ts
  const tokens: Record<string, StockToken> = Object.fromEntries(
    Object.entries(this.state.initialTokens).map(([tokenId, owner]) => [tokenId, { owner }]),
  )
  ...
  for (const operation of this.state.operations.sort(...)) {
    if (operation.kind === 'inventory.restock') {
      ...
      for (const [tokenId, owner] of Object.entries(this.state.allocations ?? {})) {
        if (tokens[tokenId] && !tokens[tokenId].consumedBy) tokens[tokenId].owner = owner
      }
      ...
    } else if (operation.kind === 'inventory.transfer') { ... }
  ```
- **Why this is a critical bug:**
  1. The loop applying `this.state.allocations` is placed **inside** `if (operation.kind === 'inventory.restock')`!
  2. When a product is created via initial seed or `product.restore` (which is how all initial products and the M5 test products are created!), `this.state.initialTokens` has the tokens (e.g., `p-allocation:restore:initial:0..2`) and `this.state.operations` is **empty (`[]`)** (or has only `decrement` operations).
  3. Because there is no `inventory.restock` operation in `this.state.operations`, the `if (operation.kind === 'inventory.restock')` branch **never executes** during `recompute()`!
  4. Therefore, `stock.allocate('browser-a', 2)` writes `this.state.allocations[tokenId] = 'browser-a'` and calls `this.recompute()`, which **leaves all initial tokens owned by `allocation-server` (`availableRights('browser-a') === 0`)**!
  5. Why did the M5 test in `server.test.ts` pass? Because the test only asserted `expect(owners.filter(owner => owner === 'browser-a')).toHaveLength(2)` by inspecting the raw `states[product.id].allocations` map, **and never checked `availableRights('browser-a')` or attempted to perform a decrement from `browser-a`**! If `browser-a` actually tries to decrement stock using its allocated rights, it fails with `"no-effect"` / `"This device has no escrow rights available for this decrement"`!
  6. Furthermore, placing `this.state.allocations` inside `inventory.restock` means that every time any `inventory.restock` runs, it overwrites `tokens[tokenId].owner = owner`, clobbering any `inventory.transfer` that occurred earlier in the operation list!

#### Defect STOCK-2 (P0): Frontend Never Requests Stock Rights and Overwrites Initial Tokens with Self-Owned Local Tokens
- **Location:** [`MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L82-L85) and `src/services/container.ts` (line 42 on `origin/wip/milestone-2`).
- **Mechanism:**
  - When `MockRepository` starts up in the browser, lines 82–85 create initial stock ledgers for every seeded product with **all tokens owned by the local browser replica** (`EscrowedStock.create(engine.replicaId, product.stock, ...)`).
  - If two browsers (Replica A and Replica B) start offline with the seeded catalog (where `product.stock = 18`), Replica A thinks it owns 18 tokens (`p1:replica-A:initial:0..17`) and Replica B thinks it owns 18 tokens (`p1:replica-B:initial:0..17`). Both can sell 18 units offline, and when they sync to the server, the server doesn't recognize either replica's `:initial:` token IDs!
  - And when `container.ts` calls `backendClient.registerReplica(engine.replicaId)`, it passes `requestedRights = undefined`! The browser **never requests any stock allocation** from `/v1/bootstrap`, so after hydrating `bootstrap.stockStates` from the server, all tokens are owned by `backend-replica` and the browser has **zero decrement rights** for every product in the catalog!

#### Defect STOCK-3 (P1): Server Recovery Rebuilds `VersionedRetailRuntime` From Log After Loading `bootstrap.stockStates`, Lost Allocations on `product.restore`
- **Location:** `server.ts` on `origin/wip/milestone-2` (lines 247–264) and `VersionedRetailRuntime.apply()` (lines 75–76).
- **Mechanism:**
  - If a product is created via a logged `product.restore` operation, `retailRuntime.getCatalog().products` is empty before log replay.
  - On server startup, `new VersionedRetailRuntime(retailRuntime.getCatalog(), replicaId, bootstrap.stockStates)` only loads `bootstrap.stockStates` for products in `retailRuntime.getCatalog().products` (which is empty!).
  - Then, log replay runs `for (const entry of logEntries) versionedRuntime.apply(entry.operation)`. When `product.restore` is replayed (lines 75–76 of `VersionedRetailRuntime.ts`), it calls `EscrowedStock.create(this.replicaId, operation.product.stock, ...)` instead of checking `stockStates[operation.product.id]`!
  - Then line 263 calls `persistBootstrap()`, which **overwrites `bootstrap.stockStates` with the freshly created unallocated `EscrowedStock`**, wiping out all persisted token allocations on server restart!

#### Defect STOCK-4 (P1): Optimistic Local Stock Decrement Is Not Rolled Back When Backend Returns `no-effect` or `rejected`
- **Location:** `SyncEngine.finishSync()` and `MockRepository.recordAdjustment()`.
- **Mechanism:** M5 records `latestStockOutcome` on `SyncSnapshot` and renders a card on `SyncStatusPage`. However, if a local stock operation results in `status: 'no-effect'` or `'rejected'` on the server, `MockRepository` does not revert its optimistic `product.stock` mutation or mark the `StockAdjustment` entry in history as rejected.

---

## 6. Persistence and Recovery Audit

### 6.1 Backend Persistence (`FileReplicaStore` & `DurableOperationLog`)
- **Strengths:**
  - [`FileReplicaStore`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/persistence/ReplicaStore.ts#L153-L334) uses exclusive lockfile creation (`openSync(lockPath, 'wx')`) and atomic temp-file rename (`writeFileSync(tmp)` + `renameSync(tmp, filePath)`).
  - `server.ts` implements log-authoritative recovery with a recovery checkpoint (`status: "recovering"` -> replay `DurableOperationLog` -> `status: "complete"`).
  - Stage-injected crash recovery tests (`afterAppend`, `afterApply`, `beforeCheckpoint`, `afterCheckpoint`, `beforeAppend`) in `server.test.ts` verify that operations appended to the log survive crashes and operations crashing before append do not leak.
- **Weaknesses / Bugs:**
  1. **Duplicate `persistBootstrap()` call in `server.ts`:** On `origin/wip/milestone-2` (`src/backend/api/server.ts` lines 440–441), `persistBootstrap()` is called twice back-to-back on every accepted operation (`persistBootstrap(); persistBootstrap();`), performing redundant synchronous disk writes.
  2. **O(N²) Full-File Serialization Per Operation:** For a batch of $k$ operations in `POST /v1/sync/operations`, each operation triggers:
     - `log.append()` -> full JSON read + full JSON write of `replicas.json`
     - `persistRecovery("recovering")` -> full JSON read + write
     - `persistBootstrap()` (x2) -> 2x full JSON read + write
     - `persistRecovery("complete")` -> full JSON read + write
     That is **5 full-file read/write/rename cycles per single operation** (500 synchronous file rewrites for a 100-operation batch).
  3. **Stale Lock File on Process Crash:** If the Node process is killed with `SIGKILL` (or power loss) while holding `replicas.json.lock`, the lockfile is never unlinked in `finally`, permanently wedging the server on restart with `FileReplicaStoreLockError`.
  4. **Lost Stock Allocations on Restart (Defect STOCK-3):** As detailed in Section 5.1, `VersionedRetailRuntime` ignores `stockStates` for log-restored products during startup replay and overwrites `bootstrap.stockStates`.

### 6.2 Browser Persistence (`localStorage`)
- **Strengths:**
  - M5 added [`installationIdentity.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/lib/storage.ts), persisting `deviceId` and `replicaId` in `syncdesk.installation.v1` and failing fast via `StorageUnavailableError` / `InstallationIdentityError` when storage is disabled.
- **Weaknesses / Bugs:**
  1. **Silent Write Failure in `writeJson()`:** In [`src/lib/storage.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/lib/storage.ts#L42-L48), `writeJson()` still wraps `storage.setItem(key, JSON.stringify(value))` in a `try { ... } catch { /* Quota or disabled storage — keep running in memory. */ }`. While initial identity creation checks persistence, subsequent queue, cursor, and catalog writes fail silently on quota exhaustion.
  2. **Non-Atomic Split Keys (Defect SYNC-2):** `syncdesk.data.v1` and `syncdesk.sync.v1` can desynchronize on tab crash.

---

## 7. Test Quality and Coverage Audit

### 7.1 Test Inventory
- **On `main` (`e822203`):** 32 test files, 214 passing tests.
- **On `origin/wip/milestone-2` (`eedd28e`):** 35 test files (adds `src/lib/installationIdentity.test.ts`, `src/backend/integration/multiReplica.test.ts`, `src/backend/integration/persistenceRecovery.test.ts`, plus expanded unit tests in `server.test.ts`, `versionedRetailRuntime.test.ts`, `retailSync.v2.test.ts`, `stock.test.ts`).

### 7.2 Assessment of Test Rigor and Blind Spots
1. **What Is Well-Tested:**
   - Generic CRDT primitives (`HLC`, `LWWRegister`, `PNCounter`, `ORSet`, causal-stability GC).
   - In-process research simulators (`ReplicaSimulator`, `RetailReplicaSimulator`) and reproducible artifact generation.
   - Single-operation crash recovery stages on the HTTP server.
   - Schema validation for v1 and v2 retail operations.
2. **Critical Test Blind Spots (Why P0 Bugs Escaped M5 Tests):**
   - **No Multi-Replica `MockRepository` + `SyncEngine` E2E Test:** Look at `src/backend/integration/multiReplica.test.ts` on `origin/wip/milestone-2`. When testing multi-replica convergence, the test **did not instantiate two `MockRepository` + `SyncEngine` instances**! Instead, it pushed raw JSON via `httpRequest` and manually replayed the log into two `VersionedRetailRuntime` instances. Thus, `MockRepository`'s broken restore-tombstone handling (Defect CRDT-1), category resurrection (Defect CRDT-2), clock mismatch (Defect SYNC-4), and hydration bug (Defect SYNC-1) were **never exercised in multi-replica tests**!
   - **Shallow Assertion on Stock Allocation:** In `server.test.ts`, `"allocates canonical stock rights once..."` checked `states[product.id].allocations` without calling `availableRights('browser-a')` or executing an `inventory.decrement` as `browser-a`. This hid Defect STOCK-1 (that allocated initial tokens are never transferred in `recompute()`) and Defect STOCK-3 (that restart wipes out allocations on restored products).
   - **Legacy Benchmark Runner Broken / Untested Against v2:** [`scripts/run-distributed-experiment.mjs`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/scripts/run-distributed-experiment.mjs) still posts legacy unversioned `product.upsert` and `product.delete` operations to `/v1/retail/operations` and reads `/v1/retail/state`, completely bypassing the Milestone 4/5 server-mediated versioned CRDT log (`/v1/sync/operations`) and `EscrowedStock`.

---

## 8. Prioritized Remaining Work (P0 / P1 / P2 / P3)

### P0 — Blocking Correctness & Git Baseline Alignment (Must Fix Immediately)
1. **Align Git `main` with M5 Branch (`origin/wip/milestone-2`):** Fast-forward or merge `origin/wip/milestone-2` (`eedd28efc9e00c88a3edd19c505914a4f8794782`) into `main` so the repository `HEAD` actually contains the M2.1–M5 commits.
2. **Fix `EscrowedStock.allocate()` and `recompute()` (Defect STOCK-1):** Apply `this.state.allocations` to initial and restocked tokens *before* processing transfers and decrements in `recompute()` (outside the `inventory.restock` loop), or record allocations as canonical transfer operations so ownership transfers work on initial/restored stock and respect causal order.
3. **Fix Bootstrap Stock Allocation Persistence Across Server Restart (Defect STOCK-3):** Ensure `VersionedRetailRuntime` preserves/restores `stockStates` (including `allocations`) when replaying `product.restore` from the durable operation log on startup, and remove the duplicate `persistBootstrap()` call.
4. **Fix Product & Category Delete/Restore/Patch Convergence in `MockRepository` and `VersionedRetailRuntime` (Defects CRDT-1 & CRDT-2):**
   - Clear `metadata.productTombstones[productId]` upon valid `product.restore` in `MockRepository`.
   - Enforce identical version comparison rules for `product.delete`, `product.patch`, `product.restore`, `category.delete`, and `category.patch` across both `VersionedRetailRuntime` and `MockRepository` so delivery permutations always converge to identical state.
5. **Fix Context-Sensitive `category.delete` Divergence (Defect CRDT-3):** Do not silently drop remote `category.delete` operations in `MockRepository` while marking them applied, and handle rejected push operations in `SyncEngine` without permanently wedging the client's pending queue.
6. **Fix Browser Bootstrap Hydration & Stock Rights Request (Defects SYNC-1 & STOCK-2):**
   - Coordinate initial bootstrap hydration with `SyncEngine` so an empty server catalog does not wipe out local data into tombstones, and properly request/hydrate stock escrow rights and cursor state.

### P1 — Synchronization Reliability & End-to-End Fidelity
1. **Unify Stock Operation Version Assignment (Defect SYNC-4):** Ensure `MockRepository` and `SyncEngine` apply the exact same `RetailVersion` (`logicalTime`, `replicaId`, `operationId`) to local `EscrowedStock` and the transmitted `VersionedRetailOperation`.
2. **Make Category Updates Field-Level Patches (Defect CRDT-4):** Emit only changed category fields in `MockRepository.updateCategory()` (`category.patch`) rather than overwriting all category fields.
3. **Reconcile Rejected/No-Effect Stock Operations Locally (Defect STOCK-4):** When the server returns `rejected` or `no-effect` for a stock operation, reconcile local stock state/history so the UI does not display divergent optimistic stock forever.
4. **Add True Multi-Replica End-to-End Tests (`MockRepository` + `SyncEngine` <-> HTTP Server <-> `MockRepository` + `SyncEngine`):** Test two full client stacks synchronizing through the HTTP server under concurrent edits, deletes/restores, category deletions, stock allocations/decrements, and restarts.

### P2 — Experimental Evaluation & Benchmark Alignment
1. **Upgrade `scripts/run-distributed-experiment.mjs` to v2 Protocol:** Update the multi-process experiment script to exercise `/v1/sync/operations` (schemaVersion 2) and `/v1/bootstrap` (including concurrent same-field conflicts and escrowed stock decrements), rather than legacy v1 `product.upsert`.
2. **Real Byte & Operation Accounting in `SyncEngine`:** Record actual serialized JSON payload bytes sent/received over `/v1/sync/operations` instead of synthetic constants (`180 + received * 120`).
3. **Comparable Transport Metrics in Research Runners:** Populate baseline byte metrics in `experimentRunner.ts` so CRDT vs. Client-Server LWW comparisons measure both convergence and bandwidth/metadata overhead on equal footing.

### P3 — Polish, Performance & Operational Hardening
1. **Batch Persistence in `POST /v1/sync/operations`:** Coalesce `FileReplicaStore` writes per HTTP batch rather than executing 5 full-file atomic renames per individual operation.
2. **Stale Lock Recovery in `FileReplicaStore`:** Include PID/timestamp metadata in `.lock` files or clean up stale locks on server startup.
3. **Clarify or Connect `DevicesPage` Telemetry:** Clearly label simulated peer devices in the UI or expose actual registered replica count/status from `/v1/bootstrap`.

---

## 9. Final Verdict

### 9.1 Is the Software Functionally Complete?
**No — Partial / Conditionally Incomplete.**
While the UI, local repository, durable operation log, crash-recovery checkpoints, and versioned protocol scaffolding are implemented, **critical correctness bugs** remain:
1. The M5 work (`eedd28e`) is still sitting on `origin/wip/milestone-2` and has **not been merged into `main` (`e822203`)**.
2. Even on `origin/wip/milestone-2`, **escrowed stock allocation (`EscrowedStock.allocate()`) is functionally broken** for initial/restored products because `recompute()` only applies `this.state.allocations` inside `if (operation.kind === 'inventory.restock')` (Defect STOCK-1), and server restart wipes out allocations on log-restored products (Defect STOCK-3).
3. `MockRepository` and `VersionedRetailRuntime` have **convergence bugs** on delete-then-restore-then-patch (Defect CRDT-1), out-of-order category delete/patch (Defect CRDT-2), and context-dependent category deletion (Defect CRDT-3).
4. Browser startup hydration (`container.ts`) races with `SyncEngine`, requests zero stock allocation rights, and wipes local seeded products if the backend starts empty (Defects SYNC-1 & STOCK-2).

### 9.2 Is It Ready for Experimental Evaluation?
**Not Yet (Blocked by P0 and P2-1).**
- In-process unit experiments for generic CRDT primitives (`orSet.gc.test.ts`, `retailSimulator.test.ts`) are reproducible and valid as **algorithmic model simulations**.
- However, the system is **not yet ready for end-to-end or multi-process experimental evaluation** because:
  1. Multi-replica client convergence (`MockRepository` <-> Server <-> `MockRepository`) and stock escrow allocation fail under realistic schedules due to the P0 defects above.
  2. The multi-process runner (`scripts/run-distributed-experiment.mjs`) still runs against the legacy v1 whole-object endpoint (`/v1/retail/operations`) rather than the v2 CRDT operation-log protocol (`/v1/sync/operations`).

Resolving the **P0** items (and updating the experiment script in **P2-1**) is a bounded, high-leverage engineering effort that will preserve the existing architecture while making the system genuinely sound, convergent, and ready for thesis experimental evaluation.
