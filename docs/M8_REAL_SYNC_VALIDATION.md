# Milestone 8 — Real Client Synchronization Validation

**Date:** 2026-11-20
**Branch:** `fix/m6-p0-correctness`
**Audited M7 Baseline Commit:** `a6c0c3d584627bd0f8c119c1c83d55421e7f11bf`

---

## 1. Phase 1 — Audit of M5 / M7 Integration Tests

Every test in [`src/backend/integration/multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts) and [`src/services/backendApi.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/backendApi.test.ts) was audited against five strict criteria:
1. **Independent `MockRepository` instances** (client domain/storage layer)
2. **Independent `SyncEngine` instances** (client queue, clock, cursor, retry coordinator)
3. **Distinct Replica Identities** (`replicaId` & `deviceId`)
4. **Isolated Local Persistence States** (separate `KeyValueStorage` instances per client)
5. **Real HTTP Backend Connections** (`BackendApiClient` over TCP loopback to `startBackendServer`)

### 1.1 Classification of Pre-Existing M5 / M7 Integration Tests

| Test Name & Location | `MockRepository` | `SyncEngine` | Distinct Identities | Isolated Storage | Real HTTP Backend | True Client Classification |
|---|---|---|---|---|---|---|
| `multiReplica.test.ts`: `"completes catalog creation, update, referential rejection, and convergence"` | No (`VersionedRetailRuntime` only) | No (raw `httpRequest`) | Yes (`replica-a`, `replica-b`) | No | Yes | **Backend HTTP + Runtime Unit Test** (Bypasses frontend client stack) |
| `multiReplica.test.ts`: `"propagates the canonical stock outcome through SyncEngine state"` | No (`engine.enqueue` directly) | 1 instance | Yes (`replica-outcome`) | 1 `MemoryStorage` | Yes | **Single-Client Engine-to-Backend Test** |
| `multiReplica.test.ts`: `"registers independent replicas and converges concurrent catalog edits"` | No (`VersionedRetailRuntime` only) | No (raw `httpRequest`) | Yes (`replica-a`, `replica-b`) | No | Yes | **Backend HTTP + Runtime Unit Test** |
| `multiReplica.test.ts`: `"retries duplicate delivery and advances a cursor only after applying a page"` | No (`VersionedRetailRuntime` only) | No (raw `httpRequest`) | Yes | No | Yes | **Backend Log Paging Test** |
| `multiReplica.test.ts` (M7): `"converges product delete, restore, and subsequent patches across MockRepository replicas and restart (CRDT-1)"` | Yes (2 independent instances + 1 restarted instance) | Yes (2 + 1 restarted) | Yes (`replica-a`, `replica-b`) | Yes (`storageA`, `storageB`) | Yes (`BackendApiClient`) | **True Multi-Client E2E Synchronization Test** |
| `multiReplica.test.ts` (M7): `"converges category delete and patch permutations across independent MockRepository replicas without resurrecting deleted categories (CRDT-2)"` | Yes (2 instances) | Yes (2 instances, offline) | Yes (`rep-ab`, `rep-ba`) | Yes (`storageAB`, `storageBA`) | No (direct `applyVersionedOperation` call) | **Multi-Repository In-Memory Permutation Test** (Bypassed HTTP & `SyncEngine` push/pull) |
| `multiReplica.test.ts` (M7): `"does not advance cursor or mark remote category.delete applied when blocked by local referential integrity, and applies it after resolution (CRDT-3)"` | Yes (1 client + 1 server push client) | Yes (1 instance) | Yes (`replica-crdt3`, `server`) | Yes | Yes | **Single-Client Pull Recovery E2E Test** |
| `backendApi.test.ts`: `"converges two independent browser replicas through versioned HTTP sync"` | Yes (2 instances) | Yes (2 instances) | Yes (`browser-a`, `browser-b`) | Yes (`firstStorage`, `secondStorage`) | Yes | **True Multi-Client E2E Synchronization Test** |
| `backendApi.test.ts`: `"resolves concurrent browser writes deterministically after both replicas reconnect"` | Yes (2 instances) | Yes (2 instances) | Yes (`browser-a`, `browser-b`) | Yes | Yes | **True Multi-Client E2E Synchronization Test** |
| `backendApi.test.ts`: `"preserves different-field edits across independent browser replicas"` | Yes (2 instances) | Yes (2 instances) | Yes (`browser-a`, `browser-b`) | Yes | Yes | **True Multi-Client E2E Synchronization Test** |

### 1.2 Gaps Identified During Phase 1 Audit

Inspecting the actual frontend path (`MockRepository` -> `SyncEngine` -> `BackendApiClient` -> HTTP Server -> `VersionedRetailRuntime`) revealed four gaps that were not exercised by the M5/M7 tests:
1. **Whole-Record Category Overwrite on Client Edit (Defect CRDT-4):** `MockRepository.updateCategory()` queued `category.upsert` containing all category fields (`name`, `nameAr`, `description`), which `SyncEngine.toVersionedOperation()` converted into a full-object `category.patch`. Concurrent edits to different category fields on two real `MockRepository` clients overwrote each other.
2. **Stock Logical Clock Mismatch (Defect SYNC-4):** `MockRepository.recordAdjustment()` applied local stock changes to `EscrowedStock` with `logicalTime: Date.now()` before `SyncEngine.toVersionedOperation()` assigned `logicalTime: ++this.logicalTime`.
3. **Missing Client-Side Stock Transfer Method:** While `EscrowedStock` and `VersionedRetailOperation` supported `inventory.transfer`, `MockRepository` had no method to enqueue an `inventory.transfer` through `SyncEngine`.
4. **Out-of-Order `product.patch` / Stock Operation Before `product.restore`:** When a `product.patch`, `product.delete`, or `inventory.*` operation arrived at `VersionedRetailRuntime` before the creating `product.restore` operation (under reverse-order delivery), `VersionedRetailRuntime` silently dropped the operation because `this.products.get(productId)` / `this.stocks.get(productId)` was `undefined`.

All four gaps were remediated in M8 while preserving the existing architecture.

---

## 2. Phase 2 — Real Multi-Client Synchronization Verification

All 10 required multi-client scenarios are now implemented and verified using full independent client stacks (`MockRepository` + `SyncEngine` + `KeyValueStorage` + `BackendApiClient` + HTTP Server):

| # | Scenario | Verification Test Location | Verified Outcome |
|---|---|---|---|
| 1 | **Two clients editing concurrently** | `backendApi.test.ts`: `"resolves concurrent browser writes..."` & `"preserves different-field edits..."` | Both different-field edits survive; same-field conflicts resolve deterministically to identical state. |
| 2 | **Three clients editing concurrently** | `multiReplica.test.ts`: `"converges three independent offline clients editing products and categories concurrently after reconnection"` | Clients A, B, C concurrently edit product fields, category fields, and create products while offline; all 3 reach identical product and category state after 2 sync rounds. |
| 3 | **Offline operations followed by reconnection** | `multiReplica.test.ts`: `"converges three independent offline clients..."` | `goOffline()` queues versioned operations locally; `goOnline()` + `syncNow()` pushes pending batches and pulls remote log to convergence. |
| 4 | **Duplicate operation delivery** | `multiReplica.test.ts`: `"converges when SyncEngine receives out-of-order and duplicate operation pages across client and server restarts"` | Duplicate entries in pulled operation pages and repeated push submissions are deduplicated idempotently with zero state corruption. |
| 5 | **Out-of-order operation delivery** | `multiReplica.test.ts`: `"converges when SyncEngine receives out-of-order and duplicate operation pages..."` & `distributedExperiment.test.ts` | Reordered delivery (e.g., `category.delete` at $v=3$ delivered before stale `category.patch` at $v=2$, or `product.patch` delivered before `product.restore`) converges to the exact same state as in-order delivery. |
| 6 | **Client restart during synchronization** | `multiReplica.test.ts`: `"converges product delete, restore, and subsequent patches across MockRepository replicas and restart (CRDT-1)"` & `"preserves head-of-line blocked cursor across client restart..."` | Disposing `SyncEngine` and re-instantiating `SyncEngine` + `MockRepository` against the same `KeyValueStorage` preserves replica identity, cursor, pending queue, and applied operation IDs. |
| 7 | **Backend restart during synchronization** | `backendApi.test.ts`: `"recovers a browser cursor and operation log after backend restart"` & `persistenceRecovery.test.ts` | Closing and restarting `startBackendServer` against the same `ReplicaStore` / `FileReplicaStore` replays `DurableOperationLog` and preserves `bootstrap.stockStates` and client cursor continuity. |
| 8 | **Product delete, restore, and patch** | `multiReplica.test.ts`: `"converges product delete, restore, and subsequent patches across MockRepository replicas and restart (CRDT-1)"` | Delete tombstones the product; restore clears the tombstone and updates field versions; subsequent patches apply and propagate across restarted clients. |
| 9 | **Category delete and patch** | `multiReplica.test.ts`: `"converges three independent offline clients..."` & `"converges when SyncEngine receives out-of-order and duplicate operation pages..."` | Field-level category patches merge concurrent `name` and `description` edits; `category.delete` dominates older/concurrent field patches without resurrection. |
| 10 | **Stock allocation, transfer, and decrement** | `multiReplica.test.ts`: `"converges stock allocation, peer transfer, and decrement across independent client stacks"` | Client A bootstraps 4 stock rights, decrements 1, and transfers 2 rights via `repoA.transferStockRights()` to Client B; Client B pulls the transfer, decrements 2 units, and both clients + server converge to `stock = 1` (`A: 1 right, B: 0 rights`). |

---

## 3. Phase 3 — Cursor & Head-of-Line Blocking Recovery

### 3.1 Head-of-Line Blocking Mechanism
Because `/v1/sync/operations` is a single monotonically ordered global operation log per server and each client maintains a scalar integer cursor (`after=<cursor>`), an operation at log position $p$ that cannot be applied locally due to a domain referential constraint (specifically, a remote `category.delete` for a category still referenced by a local product on that client) causes **head-of-line (HOL) blocking** at position $p$:
1. Operations at positions $< p$ in the same pulled page **are applied**, added to `appliedOperationIds`, and `this.cursor` advances to $p - 1$ (`lastAppliedPosition`).
2. At position $p$, `MockRepository.applyVersionedOperation` throws `RepositoryError` **before** adding the operation ID to `metadata.applied`.
3. `SyncEngine.pullVersionedOperations` catches the error, persists `this.cursor = p - 1`, transitions `phase` to `'error'`, and records `lastError`.
4. Neither position $p$ nor any operation at position $> p$ is silently skipped.

### 3.2 Verified Recovery Workflow (Including Client Restart While Blocked)
Tested in `multiReplica.test.ts`: `"preserves head-of-line blocked cursor across client restart while blocked, and advances after reference resolution"`:
1. **Detection:** The client pull stops at `cursor = 1` when position `2` (`hol-cat-delete` on `c-drinks`) is blocked by local products in `c-drinks`, while position `3` (`hol-other-patch` on `c-bakery`) waits behind position `2`.
2. **Restart Persistence:** When the client restarts while blocked, it reloads `cursor = 1` from `syncdesk.sync.v1`. Retrying before resolving the local reference fails identically at position `2` and keeps `cursor = 1`.
3. **Resolution & Automatic Cursor Advancement:** Once the local products referencing `c-drinks` are deleted or moved to another category (`c-bakery`), the next sync pull resumes from `after=1`, applies position `2` (`hol-cat-delete`), applies position `3` (`hol-other-patch`), and advances `cursor` to `3`.
4. **Failed Push Recovery:** If a local pending operation fails permanently, `SyncEngine.removeChange(id)` now permits removing a change in `'failed'` status (`!target.discardable && target.status !== 'failed'`), providing an explicit recovery path so a rejected local operation does not permanently wedge the outbound push queue.

---

## 4. Exact Validation Commands and Results

```bash
npx vitest run src/backend/integration/multiReplica.test.ts src/backend/integration/distributedExperiment.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

- `multiReplica.test.ts`: **11 passed (11)**
- `distributedExperiment.test.ts`: **9 passed (9)**
- Full `npm test`: **36 test files passed, 258 tests passed**
- `npm run typecheck`: **Passed (0 errors)**
- `npm run build`: **Passed (2,087 modules transformed)**
- `git diff --check`: **Passed (0 whitespace/formatting errors)**
