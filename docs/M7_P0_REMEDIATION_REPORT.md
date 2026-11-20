# Milestone 7 — P0 Correctness Remediation Report

**Date:** 2026-11-20
**Branch:** `fix/m6-p0-correctness`
**Base Commit (M5 Baseline):** `eedd28efc9e00c88a3edd19c505914a4f8794782` (`origin/wip/milestone-2`)
**Unchanged `main` Commit:** `e822203470e5e7d58792d060b0ea32d179c4d691`

---

## 1. Git Preparation & Commit Provenance

Per Part A of the M7 specification:
1. `origin/wip/milestone-2` was verified at `eedd28efc9e00c88a3edd19c505914a4f8794782` with intact ancestry descending from `cbb6b48`.
2. `main` was preserved unchanged at `e822203470e5e7d58792d060b0ea32d179c4d691`.
3. Dedicated branch `fix/m6-p0-correctness` was created from `eedd28efc9e00c88a3edd19c505914a4f8794782`.
4. The M6 audit report ([`docs/M6_INDEPENDENT_SOFTWARE_AUDIT.md`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/docs/M6_INDEPENDENT_SOFTWARE_AUDIT.md)) was committed first with zero application source changes, followed by three logically separated P0 fix commits:

| Sequence | Commit SHA | Commit Message | Scope |
|---|---|---|---|
| 1 | `1ec0ed69aaca7a34ed6600ea8ba37f53fd8f548b` | `docs: add M6 independent software audit` | Read-only M6 audit report (`docs/M6_INDEPENDENT_SOFTWARE_AUDIT.md`) |
| 2 | `f01575a7ae0b65070b2c3a2b48b2dd65f0825db1` | `fix: correct escrow stock allocation and recovery` | P0-A: `STOCK-1`, `STOCK-3`, transfer/restock ownership preservation |
| 3 | `d2602edcc93693a6bb910af457a0697bbd2f2a83` | `fix: make bootstrap preserve catalog and stock rights` | P0-B: `SYNC-1`, `STOCK-2`, explicit bootstrap catalog & stock rights |
| 4 | `43db1a9` | `fix: enforce deterministic retail CRDT operation semantics` | P0-C: `CRDT-1`, `CRDT-2`, `CRDT-3`, `CRDT-5` |

---

## 2. Detailed Defect Remediation Record

### 2.1 P0-A: Escrow Stock Allocation and Recovery (`f01575a7ae0b65070b2c3a2b48b2dd65f0825db1`)

#### Defect STOCK-1: Allocation Ownership Broken for Seeded/Restored Products & Overwritten on Restock
- **Original Defect:** Calling `EscrowedStock.allocate(replicaId, count)` on any initially seeded or restored product recorded entries in `this.state.allocations`, but left `availableRights(replicaId)` at `0`. Furthermore, any subsequent `inventory.restock` operation overwrote token ownership from `this.state.allocations`, destroying prior `inventory.transfer` operations.
- **Root Cause:** In [`src/domain/stock.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/stock.ts), `recompute()` initialized `tokens` from `this.state.initialTokens` without applying `this.state.allocations`, and instead iterated over `this.state.allocations` **inside** `if (operation.kind === 'inventory.restock')`. When a product had no `inventory.restock` operations, allocations were never applied; when a product did have a later `inventory.restock`, the loop re-applied `this.state.allocations` over tokens that had already been transferred via `inventory.transfer`.
- **Files Changed:**
  - [`src/domain/stock.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/stock.ts)
  - [`src/domain/stock.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/stock.test.ts)
- **Fix Implemented:** Applied `allocations[tokenId] ?? owner` when materializing initial tokens from `this.state.initialTokens` and when minting new tokens in `inventory.restock`, removing the destructive post-restock override loop so subsequent `inventory.transfer` and `inventory.decrement` operations execute in causal version order.
- **Regression Tests Added:**
  - `src/domain/stock.test.ts`: `"allocates initial and restored stock rights, allows authorized decrements, and rejects unauthorized or excessive decrements"`
  - `src/domain/stock.test.ts`: `"preserves previous transfers and allocations when restocking"`

#### Defect STOCK-3: Server Restart & Operation-Log Replay Wiped Allocated Stock Rights
- **Original Defect:** When the backend server restarted and replayed `product.restore` entries from `DurableOperationLog`, all previously granted replica stock allocations in `bootstrap.stockStates` were overwritten with unallocated ledgers owned solely by the server.
- **Root Cause:** In [`src/backend/sync/versionedRetailRuntime.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts), the constructor only populated `this.stocks` from `stockStates` for products already present in `initial.products` (which is empty for v2 log-restored products prior to log replay). During log replay, `product.restore` saw `!this.stocks.has(productId)` and created a brand-new unallocated `EscrowedStock`, which `persistBootstrap()` in [`src/backend/api/server.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/api/server.ts) then wrote back to disk (along with a duplicate `persistBootstrap()` call).
- **Files Changed:**
  - [`src/backend/sync/versionedRetailRuntime.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts)
  - [`src/backend/api/server.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/api/server.ts)
  - [`src/backend/api/server.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/api/server.test.ts)
- **Fix Implemented:**
  - Pre-populated `this.stocks` in `VersionedRetailRuntime` from all entries in `stockStates` before log replay.
  - Updated `product.restore` in `VersionedRetailRuntime` to preserve existing `EscrowedStock` instances (and their allocations/transfers), adding deficit tokens only when a previously tombstoned product is restored with higher stock, and setting the product projection's `stock` field to `stock.value()`.
  - Removed the redundant second `persistBootstrap()` call in `server.ts`.
- **Regression Tests Added:**
  - `src/backend/api/server.test.ts`: `"allocates canonical stock rights once, preserves them across server restart, and enforces ownership on decrement"`

---

### 2.2 P0-B: Bootstrap and Catalog Safety (`d2602edcc93693a6bb910af457a0697bbd2f2a83`)

#### Defects SYNC-1 & STOCK-2: Browser Registration Requested Zero Stock Rights & Empty Backend Wiped Local Seed Catalog
- **Original Defect:**
  1. On startup with `VITE_BACKEND_URL`, `container.ts` called `registerReplica(engine.replicaId)` without `requestedRights`, leaving the browser with zero escrow decrement rights after hydration.
  2. When connecting to a newly started, unseeded backend (`catalog: { products: [], categories: [] }`), `MockRepository.hydrateCatalog` treated all 16 local seeded products as "remotely deleted" and wiped the local catalog into `this.data.tombstones`.
- **Root Cause:**
  - `/v1/bootstrap` did not expose `logLength` to distinguish a genuinely unseeded new server (`catalogState: 'empty', logLength: 0`) from an initialized server whose catalog is intentionally empty after deletions (`catalogState: 'empty', logLength > 0`).
  - `POST /v1/bootstrap` only allocated `requestedRights` on the very first registration call and threw an error if a client requested rights for a local product ID not present on the server.
  - `container.ts` started `engine.start()` before bootstrap finished and never requested stock rights for local or server catalog products.
- **Files Changed:**
  - [`src/backend/api/server.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/api/server.ts)
  - [`src/services/backendApi.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/backendApi.ts)
  - [`src/repositories/MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts)
  - [`src/services/container.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/container.ts)
  - [`src/repositories/MockRepository.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.test.ts)
  - [`src/services/backendApi.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/backendApi.test.ts)
- **Fix Implemented:**
  - Exposed `initialization.logLength` in `GET /v1/bootstrap` and `POST /v1/bootstrap`.
  - Allowed `POST /v1/bootstrap` to allocate rights per known product idempotently (`granted[productId] === undefined && knownProductIds.has(productId)`), ignoring unknown client-local product IDs without failing registration.
  - Added `MockRepository.getRequestedStockRights()` and `MockRepository.hydrateBootstrap(bootstrap)` which preserves local data when `catalogState === 'empty' && (logLength ?? 0) === 0`, and authoritatively hydrates catalog and `stockStates` when `catalogState === 'data'` or `logLength > 0`.
  - Added `initializeBackendBootstrap()` in `container.ts` to request stock rights (including a second-pass allocation request if joining a server with remote products unknown locally), hydrate safely, and then start `SyncEngine`.
- **Regression Tests Added:**
  - `src/repositories/MockRepository.test.ts`: `"preserves local seed catalog when bootstrapping against a genuinely unseeded empty server"`
  - `src/repositories/MockRepository.test.ts`: `"clears local catalog when bootstrapping against an initialized server whose catalog is intentionally empty after log operations"`
  - `src/services/backendApi.test.ts`: `"bootstraps safely across unseeded server, populated server, and subsequent browser joins with stock rights"`

---

### 2.3 P0-C: Deterministic Retail CRDT Operation Semantics (`43db1a9`)

#### Defect CRDT-1: Restoring a Product Blocked Subsequent Valid Patches in `MockRepository`
- **Original Defect:** After a product was deleted and restored, any subsequent remote `product.patch` on that product was permanently ignored by `MockRepository`, causing replica divergence between `MockRepository` and `VersionedRetailRuntime`. Additionally, `MockRepository.restoreProduct()` mutated local `updatedAt` without including the updated timestamp in the queued `product.upsert` payload.
- **Root Cause:** In [`src/repositories/MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts), `applyVersionedOperation` recorded `metadata.productRestores[productId] = operation.version` on `product.restore`, **but never deleted `metadata.productTombstones[productId]`**. Later, when `product.patch` arrived, `if (product && !metadata.productTombstones[operation.productId])` evaluated to `false` forever.
- **Files Changed:**
  - [`src/repositories/MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts)
  - [`src/backend/integration/multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts)
- **Fix Implemented:** Cleared `delete metadata.productTombstones[operation.productId]` and initialized `metadata.productFields[operation.productId]` to `operation.version` on both local and remote `product.restore`, and ensured `restoreProduct()` uses the exact same `restored` record for local state and the queued operation.
- **Regression Test Added:**
  - `src/backend/integration/multiReplica.test.ts`: `"converges product delete, restore, and subsequent patches across MockRepository replicas and restart (CRDT-1)"`

#### Defect CRDT-2: Non-Commutative Category Delete and Patch Operations
- **Original Defect:** Out-of-order delivery of `category.delete` and `category.patch` produced divergent category states across replicas:
  - In `MockRepository`, a stale `category.patch` arriving after a newer `category.delete` resurrected the deleted category because `!category && typeof operation.changes.name === 'string'` did not check `metadata.categoryTombstones`.
  - In `VersionedRetailRuntime`, a newer `category.patch` arriving after `category.delete` updated `record.fields` without clearing `record.tombstone`, and an older `category.delete` arriving after a newer `category.patch` overwrote `record.tombstone` without checking `record.fieldVersions.name`.
- **Root Cause:** Asymmetric tombstone comparison rules between `category.patch` and `category.delete` in `VersionedRetailRuntime` and `MockRepository`.
- **Files Changed:**
  - [`src/backend/sync/versionedRetailRuntime.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts)
  - [`src/repositories/MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts)
  - [`src/backend/sync/versionedRetailRuntime.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.test.ts)
  - [`src/backend/integration/multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts)
- **Fix Implemented:** Enforced identical, commutative rules in both `VersionedRetailRuntime` and `MockRepository`:
  - `category.delete` applies a tombstone only if `version > tombstone` AND `version > fieldVersions.name`.
  - `category.patch` always updates per-field registers where `version > fieldVersions[field]`, and un-tombstones/creates the category if and only if `typeof changes.name === 'string'` and `version > tombstone`.
- **Regression Tests Added:**
  - `src/backend/sync/versionedRetailRuntime.test.ts`: `"converges category delete and category patch across both delivery orders, duplicate delivery, and restart replay"`
  - `src/backend/integration/multiReplica.test.ts`: `"converges category delete and patch permutations across independent MockRepository replicas without resurrecting deleted categories (CRDT-2)"`

#### Defect CRDT-3: Silent Drop & Cursor Advancement on Referential-Integrity Rejected `category.delete`
- **Original Defect:** When `MockRepository` pulled a remote `category.delete` for a category still referenced by a local product, it returned early without deleting the category, **after** adding `operation.operationId` to `metadata.applied` and allowing `SyncEngine` to add `operation.operationId` to `appliedOperationIds` and advance `this.cursor` past the operation—causing permanent silent divergence.
- **Root Cause:** Referential-integrity check in `MockRepository.applyVersionedOperation` happened after `metadata.applied.push(operation.operationId)` and silently returned `void`, while `SyncEngine.pullVersionedOperations` unconditionally marked every pulled operation ID as applied and advanced `this.cursor = page.nextCursor`.
- **Files Changed:**
  - [`src/repositories/MockRepository.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts)
  - [`src/services/sync/SyncEngine.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/sync/SyncEngine.ts)
  - [`src/backend/integration/multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts)
- **Fix Implemented:**
  - Checked referential integrity in `MockRepository.applyVersionedOperation` **before** recording `operation.operationId` in `metadata.applied`, throwing an explicit `RepositoryError` when a remote `category.delete` is blocked by local products.
  - Updated `SyncEngine.pullVersionedOperations()` to track `lastAppliedPosition` per entry; if `onVersionedOperation` throws or returns `false`, `SyncEngine` persists `this.cursor = lastAppliedPosition`, does **not** add `operation.operationId` to `appliedOperationIds`, and surfaces the sync error so the operation is retried once the referential constraint is resolved.
- **Regression Test Added:**
  - `src/backend/integration/multiReplica.test.ts`: `"does not advance cursor or mark remote category.delete applied when blocked by local referential integrity, and applies it after resolution (CRDT-3)"`

#### Defect CRDT-5: Category Deletion Validation Reachability
- **Original Defect:** On `main`, `if (operation.kind === 'category.delete')` in `validateVersionedRetailOperation` (`src/domain/retailSync.ts`) was nested inside `if (operation.kind === 'category.patch')` after a `return` statement.
- **Root Cause:** Misplaced closing brace in `src/domain/retailSync.ts` on `main` (fixed in commit `294212c` on `origin/wip/milestone-2`).
- **Files Changed:**
  - [`src/domain/retailSync.v2.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/domain/retailSync.v2.test.ts)
- **Fix Implemented:** Verified reachability on `fix/m6-p0-correctness` and expanded `retailSync.v2.test.ts` to assert both valid `category.delete` acceptance and rejection of unknown fields (`category.delete contains unknown fields`).

---

## 3. Validation Results

All validation commands were executed and passed with zero errors:

- **`npm test` (`vitest run`):** **35 test files passed, 245 tests passed** (up from 236 tests in M5; +9 comprehensive regression tests covering all P0 defects).
- **`npm run typecheck` (`tsc --noEmit`):** **Passed (0 errors)**.
- **`npm run build` (`vite build`):** **Passed (2,087 modules transformed)**.
- **`git diff --check`:** **Passed (0 formatting/whitespace issues)**.

---

## 4. Remaining Limitations (Deferred to P1 / P2 / P3 Milestones)

Per the M7 milestone boundary, only P0 blocking correctness defects were modified. The following non-P0 items from the M6 audit remain scheduled for subsequent milestones:
1. **P1-1 (Defect SYNC-4):** Unifying local stock adjustment logical clock timestamps between `MockRepository.recordAdjustment()` (`Date.now()`) and `SyncEngine.toVersionedOperation()` (`++this.logicalTime`).
2. **P1-2 (Defect CRDT-4):** Making `MockRepository.updateCategory()` emit field-level diff patches (`changes` containing only modified fields) rather than all three category fields.
3. **P1-3 (Defect STOCK-4):** Local reconciliation/rollback when the backend reports `status: 'no-effect'` or `'rejected'` for a previously queued optimistic stock operation.
4. **P1-4 (Defect SYNC-3):** Handling partial-batch operation rejections in `POST /v1/sync/operations` and `SyncEngine` without wedging non-discardable queue items.
5. **P2-1:** Upgrading `scripts/run-distributed-experiment.mjs` from legacy v1 `/v1/retail/operations` to the v2 server-mediated CRDT operation log (`/v1/sync/operations`).
6. **P2-2 / P2-3:** Real payload byte accounting in `SyncEngine` and comparable baseline transport byte metrics in `experimentRunner.ts`.
