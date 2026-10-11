# SyncDesk Project Overview

## What this project is

SyncDesk is a React/Vite application with a backend synchronization research
implementation. The product-facing application is the frontend, while the
backend work in `src/backend/` is an isolated prototype and evaluation
framework for comparing:

- A state-based CRDT synchronization model.
- An authoritative client-server last-write-wins (LWW) baseline.

The current backend is a deterministic, in-process simulator. It is suitable
for correctness experiments and reproducible application-level measurements,
but it is not yet a real multi-process or real-network deployment.

## How the code is organized

### Application shell

- `src/main.tsx` mounts the React application.
- `src/app/` contains providers, routing, theme handling, and error handling.
- `src/pages/` contains the product pages.
- `src/components/` contains reusable UI, layout, navigation, sync, and device
  components.

### Backend synchronization research

- `src/backend/crdt/`
  - Hybrid logical clock.
  - Last-write-wins register.
  - Observed-remove set (OR-Set).
  - Positive-negative counter (PN-Counter).
  - Replica composition and snapshot restoration.
- `src/backend/sync/`
  - Versioned state-sync messages.
  - Message validation and UTF-8 payload measurement.
  - Reliability helpers for deduplication, acknowledgements, and retries.
  - Deterministic virtual-time replica simulator.
  - Core experiment execution and correctness reporting.
- `src/backend/persistence/`
  - In-memory replica persistence.
  - File-backed replica persistence with validation and defensive cloning.
- `src/backend/baseline/`
  - Authoritative client-server LWW baseline.
  - Comparison helpers for running comparable workloads.
- `src/backend/research/`
  - Scenario matrix runner.
  - JSONL raw-result persistence.
  - Derived summary statistics.

## What has been completed

### CRDT correctness and state handling

- Fixed hybrid logical clock merging so a replica keeps its own identity.
- Added validation for restored clock and replica state.
- Preserved falsy LWW values such as empty strings.
- Prevented replica restoration from creating synthetic writes.
- Added validation and restoration for OR-Set tags/counters and PN-Counter
  state.
- Ensured merges do not mutate source state.
- Added tests for malformed state, restart/restore behavior, duplicate
  delivery, reordered delivery, partitions, and convergence.

### Synchronization and simulation

- Added a versioned full-state synchronization protocol.
- Added deterministic event scheduling with virtual time.
- Added simulated message delay, loss, duplication, reordering, partitions,
  reconnection, and restart events.
- Added operation and convergence reporting.
- Kept non-convergence explicit instead of inventing a convergence time.

### Persistence

- Preserved the existing in-memory persistence interface.
- Added file-backed persistence.
- Added defensive cloning and malformed-state checks.

### Client-server baseline

- Added an authoritative backend-only client-server LWW baseline.
- Defined deterministic timestamp and tie-breaking behavior.
- Defined disconnected-write behavior: writes can be buffered and submitted
  after reconnection.
- Tracks submitted, buffered, and conflicting operations.
- Kept baseline semantics explicit: authoritative state is not the same as
  eventual CRDT convergence.
- The baseline is not connected to the frontend.

### Experiment methodology and measurements

- Added a configurable scenario/seed matrix runner.
- Added unique run IDs and complete scenario configuration in raw records.
- Preserved failed runs and their error details.
- Added JSONL raw output and separate JSON summaries.
- Added median, interquartile range, mean, standard deviation, sample counts,
  convergence counts, and failed-run counts.
- Defined canonical state hashing using recursively sorted state.
- Measured application payloads at the UTF-8 JSON encoding boundary.
- Separated application payload, acknowledgement, retry, and total
  application synchronization bytes.
- Separated state, metadata, and tombstone sizes where supported.
- Kept baseline transport-byte fields `null` because no baseline application
  transport exists; `null` is not a zero-byte measurement.

### Pilot evidence

A small fixed-seed pilot was executed on 2026-10-11 with seeds `11`, `23`, and
`37`, covering stable connectivity, short partitions, long concurrent
partitions, offline reconnect, and duplicate/reordered delivery.

Observed CRDT outcomes:

- Stable connectivity: 3/3 runs converged.
- Offline reconnect: 3/3 runs converged.
- Delayed/reordered delivery: 3/3 runs converged.
- Short-partition proxy: 0/3 converged because messages were intentionally
  dropped.
- Long-partition/concurrent proxy: 0/3 converged because messages were
  intentionally dropped.

These are functional simulator observations only. They are not performance
results and do not establish superiority of either system.

The methodology and limitations are documented in
[src/backend/RESEARCH_PROTOCOL.md](src/backend/RESEARCH_PROTOCOL.md). The
real-network plan is in
[src/backend/NETWORK_VALIDATION_GUIDE.md](src/backend/NETWORK_VALIDATION_GUIDE.md).

## What still needs to be done

### Highest-priority engineering work

1. **Add a supported experiment CLI.**
   The matrix runner currently exposes TypeScript APIs and was invoked through
   a temporary test harness. Add a backend-only command that accepts scenario
   IDs, seeds, output paths, and overwrite policy.
2. **Complete the baseline transport measurement path.**
   The client-server baseline currently has no application transport, so its
   payload, acknowledgement, retry, and synchronization byte metrics remain
   `null`.
3. **Build a real backend transport only if network validation is required.**
   Add independent backend processes and a small framed transport for the
   existing versioned messages. Keep this separate from the frontend.
4. **Add transport-level tests.**
   Test framing, reconnect behavior, retry accounting, run-ID correlation,
   malformed messages, and process/node identity.

### Research work

1. Repeat the pilot with a larger, pre-registered seed set after the runner and
   transport are stable.
2. Keep planned scenarios and executed scenarios separate.
3. Preserve raw JSONL, summaries, configurations, command output, and (for
   network runs) PCAP files without overwriting earlier runs.
4. Report failed and non-converged runs instead of selecting only successful
   runs.
5. Compare application-level bytes with packet-capture measurements only after
   a real transport exists.
6. Define an observation window and fault schedule for each real-network run.
7. Do not claim performance improvements or statistical significance without
   enough comparable samples.

### Known limitations

- The simulator is not TCP and does not validate real packet behavior.
- There is no backend server entry point or socket transport.
- GNS3 and Wireshark validation has not been performed.
- Baseline transport metrics are unavailable until a transport is implemented.
- CRDT tombstone garbage collection and delta synchronization are intentionally
  out of scope.
- The current experiment procedure has no warm-up phase.
- The pilot sample is too small for performance or significance claims.
- The full test suite has an intermittent pre-existing frontend route-test
  failure; backend tests and type checking passed in the latest verification.

## Running the project locally

Install dependencies without changing the lockfile:

```powershell
npm install --no-package-lock
```

Start the frontend development server:

```powershell
npm run dev
```

Vite normally prints a local URL such as `http://localhost:5173/`. In the
current Figma Make setup, the configured preview port may be `8443`; use the
URL printed by Vite or the preview panel.

Useful verification commands:

```powershell
npm test
npm run typecheck
npm run build
npm run format
git diff --check
```

The backend research APIs are currently exercised through Vitest rather than a
production CLI. See
[src/backend/research/experimentRunner.ts](src/backend/research/experimentRunner.ts)
and
[src/backend/research/experimentRunner.test.ts](src/backend/research/experimentRunner.test.ts).

## Frontend protection

The CRDT, simulator, baseline, persistence, experiment, and research-guide
work has been kept in backend-specific files or standalone documentation. The
frontend source, frontend tests, UI wiring, shared configuration, package
manifests, and lockfiles must remain unchanged while this backend research
continues.
