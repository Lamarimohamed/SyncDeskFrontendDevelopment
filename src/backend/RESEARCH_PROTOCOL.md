# Reproducible CRDT Evaluation Protocol

## Research question and hypotheses

The experiment asks how a full-state CRDT synchronization design and an authoritative
client-server LWW baseline behave under comparable workloads and network faults. The
hypotheses are propositions to test: both systems should resolve their declared
semantics deterministically; CRDT replicas should converge after eventual full-state
exchange; the server baseline should expose a single authoritative state after
buffered offline writes are submitted.

## Variables and workload

The independent variables are system under test (`crdt` or `client-server-lww`),
replica/client count, operations per replica, partition schedule, virtual message
delay, loss, duplication, and reordering. The controlled variables are operation
identifiers, operation order, seed, value distribution, and observation window.
The default workload uses four replicas and two operations per replica. Each operation
adds a unique string value and increments the CRDT counter; the baseline receives
the same operation identifiers and deterministic timestamps.

Scenarios should include stable connectivity, repeated short partitions, long
partitions with concurrent writes, reconnection after buffered writes, and varied
delay/loss/duplication. Scenario configuration must be retained with every result.

## Procedure and reproducibility

Each run has a stable scenario ID and integer seed. Workloads and fault schedules
use virtual time and deterministic scheduling; no wall-clock sleeps are part of the
experiment. A warm-up is not used in the current functional runner. Use multiple
independent seeds per scenario for future summaries, preserving every raw run.
Failed runs are retained and excluded from derived statistics with their error
details intact.

The backend-only matrix API is in `research/experimentRunner.ts`. `runMatrix`
produces CRDT records and `runComparisonMatrix` adds client-server LWW records. A matrix contains
unique scenario IDs and unique integer seeds. `runMatrix` returns one raw record per
scenario/seed pair; `writeJsonl` and `writeSummary` persist raw and derived outputs
separately and refuse to overwrite existing files unless explicitly requested.
The default matrix covers stable connectivity, short partitions, long partitions,
offline reconnect, and duplicate/reordered delivery with seeds supplied by the
caller. A typical test/reproduction invocation is:

```ts
const records = runMatrix({ scenarios: defaultScenarioMatrix, seeds: [11, 23, 37] })
writeJsonl("research/raw/run.jsonl", records)
writeSummary("research/summary/run.json", summarize(records))
```

## Metrics and boundaries

- `encodedPayloadBytes` is the UTF-8 byte length of JSON state messages at the
  protocol encode boundary. It excludes transport framing, acknowledgements, and
  retries unless separately reported.
- State size is UTF-8 JSON bytes for the canonical final snapshot.
- CRDT metadata size is the UTF-8 JSON bytes of CRDT metadata; OR-Set additions and
  tombstones are reported separately.
- State hashes are SHA-256 hashes of recursively key-sorted canonical state.
- Convergence means every CRDT replica has the same canonical replicated state
  (register, set, and counter) at the end of the observation window.
- The client-server baseline is authoritative by definition and is compared using
  its single canonical server state; this is not equivalent to CRDT convergence.
- `convergenceTimeMs` is virtual simulator time at the end of a converged observation
  window. It is null for failed or non-converged runs; it is not wall-clock runtime.
- `totalApplicationSynchronizationBytes` is the sum of encoded application payload,
  acknowledgement, and retry payload bytes. It excludes TCP/IP framing, transport
  retransmissions, and link-layer overhead.
- Raw records use schema version 1 and include run ID, complete scenario
  configuration, operation accounting, failure details, hashes, and byte metrics.
- Baseline records use null byte fields until a baseline application transport is
  implemented; those nulls are not zero-byte measurements and are excluded from
  byte summaries.
- Summaries report sample count, median, interquartile range, mean, and population
  standard deviation over raw records in each scenario/system group.

## Interpretation limits

The runner does not claim crash durability, exactly-once network delivery, security,
or performance superiority. Results are only comparable when the workload and fault
configuration have the same semantics. No delta synchronization, tombstone
garbage collection, or production transport is included.

## Pilot executed on 2026-10-11

A functional pilot was executed with the matrix runner using seeds `11`, `23`, and
`37`, five scenarios, three CRDT runs and three client-server LWW records per
scenario. Raw records, configuration, and the derived summary are preserved under
`.tmp/pilot-20261011/`:

- `raw.jsonl`: 30 raw records (15 CRDT and 15 baseline records).
- `config.json`: seed and system configuration.
- `summary.json`: grouped descriptive statistics.

Observed pilot outcomes were limited to functional correctness, not performance
claims. Stable connectivity, offline reconnect, and deterministic delayed-ordering
CRDT runs converged in all three seeds. The short-partition proxy had zero of three
CRDT runs converge, with two intentionally dropped messages per run. The
long-partition/concurrent proxy also had zero of three CRDT runs converge, with six
dropped messages per run. Baseline records were authoritative by construction and
therefore report convergence separately from CRDT replica convergence.

The current baseline has no implemented application transport, so its encoded
payload, acknowledgement, retry, and total synchronization byte fields are null,
not zero. No network performance comparison or statistical superiority claim is
made. The pilot is reproducible with the temporary Vitest harness used to invoke
`runComparisonMatrix`; production CLI invocation remains a future improvement.

## Retail simulator experiment harness

The retail research matrix is implemented by
`research/retailExperimentRunner.ts`. It evaluates only the existing retail
simulator's `baseline` and `candidate` modes; it does not evaluate the generic
client-server runner and does not change production retail behavior.

`runRetailExperimentMatrix` expands scenario IDs and fixed seeds into explicit
initial state, operations, replica origins, and delivery schedules, then replays
the same scenario against both models. Supported scenarios include no-conflict,
different-field, same-field, delete/update, delete/restore, duplicate/reordered
delivery, three-replica partition/reconnection, category conflicts, and an
inventory-delta exploratory case. Inventory convergence is reported separately
from overselling or other business correctness.

Each raw record contains the resolved scenario, workload and initial-state
hashes, model, matrix and metric schema versions, visible-state and
protocol-state convergence status, failure details, and simulator accounting.
The retail simulator uses symmetric
link-level partitions: `partition(A)` disconnects A from every other replica,
while `partitionLink(A, B)` disconnects only the A/B link. Messages queued across
a disconnected link remain pending; a delivery call records a blocked attempt
without mutating the destination. Reconnection makes those queued messages
eligible again, and delivery order remains deterministic.

`scheduledDeliveryAttempts` counts queued delivery entries, including explicit
duplicates. `blockedDeliveryAttempts` counts delivery calls that found no
eligible queued link while partitioned. `successfulDeliveryCount` counts actual
delivery applications, including already-applied duplicate deliveries, while
`duplicateDeliveryCount` counts only those already-applied deliveries.
`serializedOperationPayloadBytes` counts the UTF-8 JSON payload for each
scheduled delivery entry, including entries that were temporarily blocked.
Final state bytes and applied-operation metadata counts are separate
measurements. Model-specific metadata not exposed by the simulator is recorded
as unavailable rather than fabricated as zero.

The retail harness metric schema is `retail-metrics-2` and the matrix version is
`retail-5e-1` for the preserved 5E evidence. New hardened runs use
`retail-metrics-3` and `retail-5h-1`; these are intentionally distinct from
earlier artifacts. Older artifacts remain interpretable under their recorded
schema and are not rewritten.

The canonical ordering used by the simulator and harness compares UTF-8 bytes,
not locale-sensitive string ordering. Seeds are deterministic inputs: fixed
regression scenarios may retain one schedule, while scenarios marked as
schedule-varied must retain a resolved scenario for every `(scenarioId, seed)`
pair in `config.json`. Baseline and candidate always replay that exact pair.

Visible-state convergence means products, categories, and inventory deltas agree.
Protocol-state convergence additionally requires the applied-operation identifier
sets to agree. The two predicates are reported separately; neither implies
production retail convergence.

`writeRetailExperimentArtifacts(directory, config, records)` writes
`config.json`, `raw.jsonl`, `summary.json`, and a final `manifest.json` completion
marker with exclusive creation and refuses to overwrite existing files. A
directory is complete only when the manifest exists with `complete: true`;
interrupted writes leave any already-created files in place and must be treated
as incomplete rather than recovered in place. Use a new absent directory for a
retry. Invalid matrix configuration is rejected before execution and produces
no run records; runtime failures are retained as failed records. Failed and
non-converged records remain in raw output and are represented in summaries.
Reproduction is programmatic:

```ts
const records = runRetailExperimentMatrix({
  matrixVersion: RETAIL_MATRIX_VERSION,
  metricSchemaVersion: RETAIL_METRIC_SCHEMA_VERSION,
  scenarioIds: [...supportedRetailScenarioIds],
  seeds: [11, 23, 37],
})
writeRetailExperimentArtifacts("research/raw/retail-pilot", {
  matrixVersion: RETAIL_MATRIX_VERSION,
  metricSchemaVersion: RETAIL_METRIC_SCHEMA_VERSION,
  scenarioIds: [...supportedRetailScenarioIds],
  seeds: [11, 23, 37],
}, records)
```

The harness is intended for a small pilot first. Its outputs are functional
correctness and accounting evidence from a deterministic in-process simulator,
not real-network measurements or a performance-superiority claim. Partition
enforcement models simulator link eligibility only; it does not prove transport
isolation, packet loss, crash behavior, or network performance.
