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
