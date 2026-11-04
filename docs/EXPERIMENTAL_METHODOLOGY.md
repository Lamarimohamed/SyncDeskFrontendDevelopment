# Experimental methodology

Each run is identified by a deterministic integer seed and a run ID. Three
independent backend processes use separate persistent volumes. The workload
performs one local write per replica while fanout is withheld, then reconnects
by delivering the upserts in reverse order followed by a deletion, and repeats
that schedule. This supplies a repeatable partition, reordering, duplicate,
and delete/add schedule without introducing an unmeasured network emulator.

Semantic convergence is defined as byte-identical canonical retail catalogs at
all active replicas after the reconnect phase. The runner additionally checks
that every expected operation ID was applied exactly once and that the expected
deleted product is absent. `convergenceTimeMs` is wall-clock time from runner
start through the final state reads; it is not the duration of a single HTTP
request. The runner records generated, transmitted, applied, and deduplicated
operation counts, application payload bytes, serialized state bytes, the seed,
replica IDs, timestamps, a semantic SHA-256 state hash, and raw CRDT metadata
hashes. Metadata equality is reported separately because local replica identity
is part of that metadata.

The generic CRDT simulator remains the controlled environment for algebraic
merge properties, virtual delay/loss, OR-Set tombstone collection, and modeled
restart scenarios. Those measurements must not be mixed with process-level
HTTP timings. TCP/IP framing, packet retransmission, and link-layer overhead
are not included in application payload bytes.
