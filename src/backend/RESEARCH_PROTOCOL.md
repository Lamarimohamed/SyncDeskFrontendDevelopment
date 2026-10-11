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

## Interpretation limits

The runner does not claim crash durability, exactly-once network delivery, security,
or performance superiority. Results are only comparable when the workload and fault
configuration have the same semantics. No delta synchronization, tombstone
garbage collection, or production transport is included.
