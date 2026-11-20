# Milestone 8 — Experimental Readiness and v2 Distributed Runner

**Date:** 2026-11-20
**Branch:** `fix/m6-p0-correctness`
**Protocol Version:** `syncdesk-retail-v2` (`schemaVersion: 2`)

---

## 1. Phase 4 — Migration of `scripts/run-distributed-experiment.mjs` to v2 Protocol

### 1.1 Audit of Previous Runner State
Prior to M8, [`scripts/run-distributed-experiment.mjs`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/scripts/run-distributed-experiment.mjs) (165 lines) still used the **legacy Milestone 1/2 v1 unversioned protocol**:
- Generated unversioned `{ operationId, kind: "product.upsert", product }` and `{ operationId, kind: "product.delete", productId }` payloads.
- Submitted operations to `POST /v1/retail/operations` (`RetailDomainRuntime` whole-object arrival-order projection).
- Inspected state via `GET /v1/retail/state` instead of `/v1/sync/catalog` and `/v1/sync/operations`.
- Reported `bandwidthOverheadBytes: null` and did not exercise `RetailVersion` conflict tie-breaking, `EscrowedStock` token operations (`inventory.restock`, `inventory.decrement`), or `/v1/bootstrap` registration.

### 1.2 v2 Runner Architecture & Capabilities
[`scripts/run-distributed-experiment.mjs`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/scripts/run-distributed-experiment.mjs) has been migrated to `schemaVersion: 2` (`protocolVersion: "syncdesk-retail-v2"`):
1. **Replica Registration:** Registers each active replica via `POST /v1/bootstrap`.
2. **Deterministic v2 Workload Generation:**
   - `category.patch` (`schemaVersion: 2`) initializing the experiment category.
   - Per-replica `product.restore` (`schemaVersion: 2`) operations with deterministic `RetailVersion` (`{ logicalTime, replicaId, operationId }`).
   - Concurrent same-field (`price` at equal `logicalTime: 20` across all replicas to force deterministic UTF-8 `replicaId` tie-breaking) and different-field (`name` vs. `description` at `logicalTime: 21`) `product.patch` operations on a shared product.
   - Versioned `inventory.restock` (`logicalTime: 30`) and `inventory.decrement` (`logicalTime: 31`) token operations recording explicit `StockOperationOutcome` counts (`applied`, `duplicate`, `no-effect`, `rejected`).
   - Versioned `product.delete` (`logicalTime: 40`) tombstone operation.
3. **Out-of-Order Creation/Patch Convergence Fix in `VersionedRetailRuntime`:**
   - Reverse-order reconnection delivery in the v2 runner exposed an important edge case: when a `product.patch` ($v=20$) or `inventory.*` operation ($v=30$) arrived at a replica *before* its creating `product.restore` ($v=2$), `VersionedRetailRuntime` previously dropped the patch/stock operation because `this.products.get(productId)` was `undefined`.
   - [`VersionedRetailRuntime.apply()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/sync/versionedRetailRuntime.ts) and [`MockRepository.applyVersionedOperation()`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/repositories/MockRepository.ts) were updated to buffer field registers, tombstones, and stock operations for not-yet-restored product IDs and deterministically merge them when `product.restore` arrives, while `catalog()` filters out partial records that have not yet received a creating `product.restore`.
4. **Comprehensive Metrics & Timeout Enforcement:**
   - Tracks `bytesSent`, `bytesReceived`, `totalBytesExchanged`, `applicationPayloadBytes`, `bandwidthOverheadBytes`, `logSizeBytesPerReplica`, `stateBytes`, `stateHash`, `metadataStateHashes`, `simulatedPacketDrops`, and `stockOperationOutcomes`.
   - Enforces `timeoutMs` (configurable via `EXPERIMENT_TIMEOUT_MS` or config JSON) and exits with non-zero code (`process.exitCode = 1`) if convergence, semantic correctness, operation preservation, or timeout checks fail.

---

## 2. Phase 5 — Reproducible Experimental Scenarios & Measured Results

All seven required experimental scenarios are supported in [`scripts/run-distributed-experiment.mjs`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/scripts/run-distributed-experiment.mjs) and verified by automated 3-server integration tests in [`src/backend/integration/distributedExperiment.test.ts`](file:///home/antigravity/Lamarimohamed/SyncDeskFrontendDevelopment/src/backend/integration/distributedExperiment.test.ts):

| Scenario ID | Fault / Network Profile | Reconnect Delivery Order | Duplicate Replay | Concurrent Field & Stock Conflicts | Automated Test Status (3 HTTP Servers) |
|---|---|---|---|---|---|
| `normal-connectivity` | `0ms` added latency, `0%` drop | Forward causal order | No | No | **PASS (`converged: true`)** |
| `high-latency` | `25ms` per-request simulated link latency | Forward order | No | Yes (same-field + different-field + stock) | **PASS (`converged: true`)** |
| `packet-loss` | `5ms` latency, drops every 2nd request + retransmission | Forward order | Yes | Yes | **PASS (`converged: true`, `simulatedPacketDrops > 0`)** |
| `short-disconnection` | 1 partition phase (`5ms` latency) before reconnect | Forward order | No | No | **PASS (`converged: true`)** |
| `long-partition` | 2 partition phases (`10ms` latency), multi-op queue | Reverse order (out-of-order) | Yes | Yes | **PASS (`converged: true`)** |
| `reconnection` | Partition local writes + reconnect fanout | Reverse order (out-of-order) | Yes | No | **PASS (`converged: true`)** |
| `concurrent-updates-during-partition` | All replicas partitioned during concurrent writes | Reverse order (out-of-order) | Yes | Yes (same-field, different-field, delete, stock) | **PASS (`converged: true`)** |

---

## 3. Exact Commands for Reproducible Execution

### 3.1 Automated Multi-Server Scenario Matrix (Vitest)
Runs all 7 scenarios against 3 independent local Node.js HTTP server instances (`replica-a`, `replica-b`, `replica-c`) plus timeout failure verification:

```bash
npx vitest run src/backend/integration/distributedExperiment.test.ts
```

### 3.2 Standalone CLI Execution Against Running Backend Replicas
To run a specific scenario against one or more live HTTP backend processes and write the JSON artifact to `.tmp/`:

```bash
EXPERIMENT_SCENARIO=concurrent-updates-during-partition \
EXPERIMENT_SEED=20261120 \
REPLICA_URLS=http://127.0.0.1:8787,http://127.0.0.1:8788,http://127.0.0.1:8789 \
npm run distributed:experiment
```

### 3.3 In-Process Research Matrix & OR-Set GC Benchmarks
```bash
npx vitest run src/backend/research/experimentRunner.test.ts src/backend/research/retailExperimentRunner.test.ts src/backend/research/gcExperiment.test.ts
npm run research:gc
```

---

## 4. Methodological Boundaries & Remaining Limitations

To preserve strict academic and engineering honesty for the Master's thesis evaluation:
1. **Application-Layer vs. Link-Layer Fault Injection:**
   - The `high-latency` and `packet-loss` profiles in `scripts/run-distributed-experiment.mjs` inject deterministic application-layer delay and drop/retransmission schedules around real HTTP loopback requests. They do **not** measure kernel TCP congestion windows, Ethernet frame headers, or physical Wi-Fi interference.
   - Similarly, `bytesSent`, `bytesReceived`, and `totalBytesExchanged` measure exact UTF-8 JSON HTTP request/response bodies exchanged over the sockets, excluding HTTP headers and TCP/IP framing.
2. **Server-Mediated vs. Multi-Server Relay Topology:**
   - In the normal browser application flow, multiple clients (`MockRepository` + `SyncEngine`) synchronize by pushing to and pulling from a single central HTTP server (`/v1/sync/operations`).
   - In the multi-server experiment runner (`run-distributed-experiment.mjs`), the runner acts as the anti-entropy coordinator that delivers operation batches across three independent backend server URLs (`replica-a`, `replica-b`, `replica-c`) and verifies that all three servers converge to identical catalog and operation-log state hashes.
3. **Unresolved Non-Blocking Items:**
   - **Docker Engine Runtime:** As in earlier milestones, Docker Engine is not installed inside this cloud sandbox VM; `scripts/validate-docker.ps1` must be executed on a host with Docker Desktop / Docker Engine if container-level network disconnect (`docker network disconnect`) captures are required.
   - **Batch Disk Write Coalescing (P3):** `FileReplicaStore` performs synchronous atomic temp-file renames per logged operation rather than per HTTP batch; sufficient for experimental workloads up to hundreds of operations, but not optimized for high-throughput production storage.
