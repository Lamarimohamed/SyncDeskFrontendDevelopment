# Local Application Acceptance Report

**Date:** 2026-11-20
**Branch:** `fix/m6-p0-correctness`
**Base Commit (M8):** `60bcf95c49896fbac5db13f0a40a50929e0ffa9e`

---

## 1. Exact Local Startup Commands & Required Environment Configuration

To run the complete SyncDesk application locally with full multi-client CRDT synchronization and file-backed persistence:

### Terminal 1 — Start the HTTP Synchronization Backend
```bash
BACKEND_STORE_PATH=.tmp/backend-replicas.json BACKEND_PORT=8787 npm run backend
```
- **Default Host/Port:** `http://127.0.0.1:8787`
- **Persistence:** `BACKEND_STORE_PATH` enables atomic file-backed persistence (`FileReplicaStore`). If omitted, the server runs with an in-memory `ReplicaStore`.
- **Health Check:** `curl http://127.0.0.1:8787/health` -> `{"status":"ok","apiVersion":"1"}`

### Terminal 2 — Start the React/Vite Frontend Connected to the Backend
```bash
VITE_BACKEND_URL=http://127.0.0.1:8787 npm run dev
```
- **Frontend URL:** `http://localhost:8443` (or `http://127.0.0.1:8443`)
- **Required Environment Variable:** `VITE_BACKEND_URL=http://127.0.0.1:8787` connects [`src/services/container.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/container.ts) to the running HTTP backend via `BackendApiClient`. (Without `VITE_BACKEND_URL`, the frontend operates in standalone local-demo mode).

---

## 2. Defects Discovered & Fixed During Local Application Audit

### Defect LOCAL-1: First Client Connecting to a Freshly Started Empty Backend Never Seeded the Backend
- **Symptom:** When a user started a fresh backend (`npm run backend`) and opened the frontend (`VITE_BACKEND_URL=http://127.0.0.1:8787 npm run dev`) in Client A, `hydrateBootstrap` preserved Client A's 11 seeded products and 3 categories locally, **but never pushed them to the unseeded backend**. As a result:
  1. The backend had `0` products and `0` categories (`catalogState: 'empty', logLength: 0`), so `registerReplica` allocated `0` stock escrow rights to Client A.
  2. When Client B opened the application to join the workspace, the backend was still empty unless Client A manually edited every single product.
  3. Any subsequent edit or stock adjustment on Client A for a seeded product (e.g., `p-coffee`) was sent to a server that had no record or stock ledger for `p-coffee`.
- **Root Cause:** `initializeBackendBootstrap` in [`src/services/container.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/container.ts) skipped overwriting local data when `catalogState === 'empty' && logLength === 0`, but did not push the initial seed catalog (`category.patch` and `product.restore` operations) to initialize the empty server.
- **Fix Implemented:**
  - Added [`MockRepository.getBootstrapSeedOperations()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L168-L198) to generate deterministic `schemaVersion: 2` `category.patch` (`seed-category-<id>`) and `product.restore` (`seed-product-<id>`) operations from the initial local catalog.
  - Updated [`initializeBackendBootstrap()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/container.ts#L39-L73) so that when a client connects to a genuinely unseeded new server (`catalogState === 'empty' && logLength === 0`), it pushes the seed operations to `/v1/sync/operations` and re-registers via `/v1/bootstrap` to receive canonical stock allocations and hydrate the initialized `stockStates`.
- **Verified Live Result:** Verified via headless Chromium connecting to `http://127.0.0.1:8443` with backend on `http://127.0.0.1:8787`: `GET /v1/bootstrap` immediately transitioned to `catalogState: "data"`, `registeredReplicaCount: 1`, `logLength: 14` (3 categories + 11 products) with full stock ledgers.

### Defect LOCAL-2: Permanently Failed Non-Discardable Changes Could Not Be Removed From the Pending UI Page
- **Symptom:** Although M8 updated `SyncEngine.removeChange(id)` to allow removing changes with `status === 'failed'`, [`MockRepository.discardPendingChange(id)`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts#L505-L517) and [`SyncPendingPage.tsx`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/pages/sync/SyncPendingPage.tsx#L63-L78) still checked only `c.discardable`, hiding the "Remove" button on `/sync/pending` for failed non-discardable operations.
- **Fix Implemented:** Updated `MockRepository.discardPendingChange()` and `SyncPendingPage.tsx` (`removeControl`) to permit removing any pending change where `c.discardable || c.status === 'failed'`.

---

## 3. Acceptance Scenario Matrix & Verification Results

| Category | Acceptance Scenario | Verification Method | Status | Evidence / Result |
|---|---|---|---|---|
| **Startup & Connectivity** | Frontend (`:8443`) & Backend (`:8787`) start locally and communicate over HTTP | Live processes (`npm run backend`, `VITE_BACKEND_URL=... npm run dev`) + headless Chromium + `curl` | **PASS** | `/health` returns `200 OK`; Chromium loads `/login`, executes `initializeBackendBootstrap`, registers replica, and seeds 14 initial operations (`logLength: 14`). |
| **Catalog Workflows** | Create product, edit product, delete product, undo/restore deleted product | [`src/app/localAcceptance.test.tsx`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/app/localAcceptance.test.tsx) + [`multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts) | **PASS** | Product created via `/products/new` UI form (`Cardamom Cold Brew`, 310 DA), pushed to HTTP server, deleted, restored via undo, and converged to second client. |
| **Category Workflows** | Create, edit, delete categories; enforce referential integrity | [`src/app/localAcceptance.test.tsx`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/app/localAcceptance.test.tsx) + [`multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts) | **PASS** | Category created (`Seasonal Specials`), renamed (`Winter Specials`), synced to server; deletion of referenced category `c-drinks` rejected with validation error; unreferenced category deleted and synced. |
| **Stock Workflows** | Initialize stock, allocate rights, decrement stock, reject unauthorized decrements, transfer rights, restock, recover after backend restart | [`src/app/localAcceptance.test.tsx`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/app/localAcceptance.test.tsx), [`multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts), [`server.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/api/server.test.ts) | **PASS** | Stock adjusted via `/stock/adjust?product=p-coffee` UI drawer; `Latest stock operation: applied` rendered on `/sync`; peer transfer (`transferStockRights`) and server restart recovery verified. |
| **Multi-Client Synchronization** | Two & three independent clients sync changes bidirectionally, offline/reconnect, concurrent updates, duplicate & out-of-order delivery, cursor HOL blocking | [`src/app/localAcceptance.test.tsx`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/app/localAcceptance.test.tsx) + [`multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts) | **PASS** | Independent client stacks (`MockRepository` + `SyncEngine` + `BackendApiClient`) converge on identical product, category, and stock states; blocked cursor halts at `lastAppliedPosition` and advances after reference resolution. |
| **Persistence & Recovery** | Browser refresh, client restart, and file-backed backend restart preserve catalog, operations, stock allocations, and sync cursor | [`persistenceRecovery.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/persistenceRecovery.test.ts), [`multiReplica.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/multiReplica.test.ts), [`backendApi.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/services/backendApi.test.ts) | **PASS** | File-backed store (`FileReplicaStore`) and client storage (`syncdesk.data.v1`, `syncdesk.sync.v1`, `syncdesk.installation.v1`) recover without data loss or resurrection. |
| **Interactive Two-Window Physical Browser Check** | Interactive human multi-tab/multi-window testing on a physical desktop display | Cloud VM sandbox has no physical display; live preview exposed on `http://localhost:8443` connected to running backend on `http://127.0.0.1:8787` | **READY FOR USER PREVIEW** | Headless Chromium verified first-load DOM and backend bootstrap seeding; full UI interaction verified via React Router + Testing Library against a live Node HTTP backend in `localAcceptance.test.tsx`. |

---

## 4. Automated Validation Results

All automated test suites, type checks, and production build checks pass:

- **`npm test` (`vitest run`):** **37 test files passed, 259 tests passed** (including the new full-stack UI + live HTTP backend acceptance test in [`src/app/localAcceptance.test.tsx`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/app/localAcceptance.test.tsx)).
- **`npm run typecheck` (`tsc --noEmit`):** **Passed (0 errors)**.
- **`npm run build` (`vite build`):** **Passed (2,087 modules transformed)**.
- **`git diff --check`:** **Passed (0 formatting/whitespace errors)**.

---

## 5. Known Limitations & Architectural Boundaries

1. **Same-Browser Multi-Tab vs. Distinct Browser Profiles:** Because browser `localStorage` is shared across tabs of the same origin (`http://localhost:8443`), opening two normal tabs in the same browser window shares `syncdesk.installation.v1`, `syncdesk.data.v1`, and `syncdesk.sync.v1`. To test two independent replicas on one physical machine, open one normal browser window and one Incognito/Private window (or two different browser profiles/browsers).
2. **Simulated Peer Device List on `/devices`:** As documented since M5, the `/devices` page renders static demo peer entries (`PEER_SEEDS`) alongside the current browser's real replica identity and state size.
3. **Explicit Stock Transfer UI Control:** While `MockRepository.transferStockRights()` and the backend `/v1/sync/operations` protocol fully execute and converge `inventory.transfer` operations between replicas, the `/stock/adjust` drawer currently exposes `Add`, `Remove`, and `Correct` actions rather than a dedicated peer-to-peer token transfer form.
