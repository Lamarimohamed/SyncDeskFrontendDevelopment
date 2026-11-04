# SyncDesk distributed validation

SyncDesk contains a generic CRDT backend, a deterministic in-process simulator,
and a process-level HTTP validation environment. The browser demo remains a
local offline queue; it is not used as evidence for distributed convergence.

## Local checks

```text
npm test
npm run typecheck
```

## Docker experiment

Docker and Docker Compose are required. The command starts three independent
backend processes, gives each process its own persistent volume, runs a
partition/reconnect workload, and writes machine-readable results to a Docker
volume:

```text
docker compose up --build --abort-on-container-exit experiment-runner
docker compose down
```

To reset all persisted replica state, including experiment output:

```text
docker compose down --volumes
```

For the full build, health, restart, network disconnect/reconnect, experiment,
logs, and clean-shutdown sequence, run:

```text
npm run distributed:validate
```

The runner output includes the seed, replica IDs, operation counts, duplicate
accounting, payload bytes, state bytes, convergence time, operation-preservation
checks, semantic state hashes, and raw CRDT metadata hashes. Set
`EXPERIMENT_SEED` in `.env` to reproduce a different deterministic run. The
runner intentionally models a partition by withholding fanout, then replays
operations in reverse order with duplicates during reconnect. Metadata hashes
are reported separately because each server's CRDT bookkeeping has a distinct
replica identity; they are not silently treated as equal.

Workloads can also be configured from JSON:

```text
$env:EXPERIMENT_CONFIG="docs/distributed-experiment.config.example.json"
npm run distributed:experiment
```

The output marks bandwidth overhead and persistent storage size as `null`
because those transport and filesystem measurements are not available at the
application boundary.

## Fault injection and restart

The Compose network is named `syncdesk`. A complete network fault can be
reproduced without an additional daemon:

```text
docker network disconnect syncdesk <container>
docker network connect syncdesk <container>
docker compose restart replica-b
```

The backend uses atomic temporary-file replacement for each replica volume.
The three health checks gate the runner, and `GET /health` is the readiness
endpoint. The current HTTP API is full-state synchronization plus a retail
operation endpoint; it does not claim direct replica-to-replica LAN sync.

## Architecture

```text
                         syncdesk bridge network
       +----------------------+----------------------+----------------------+
       |                      |                      |                      |
  replica-a             replica-b             replica-c             runner
  HTTP :8787            HTTP :8787            HTTP :8787            JSON output
  volume A              volume B              volume C
       |                      |                      |
       +---------- durable backend state -------------+
```

The backend flow is `HTTP request -> serialized request chain -> CRDT/runtime
candidate -> atomic persistence -> response`. Generic sync messages use
`ReplicaRuntime` and `ReliableSyncEndpoint`; retail operations retain operation
IDs for duplicate handling.

## Scope and interpretation

The process runner validates independent processes, persistence boundaries,
reordered and duplicate operation delivery, restartability, and eventual
catalog equality for the supported retail endpoint. The in-process simulator
and CRDT tests remain the evidence for generic OR-Set, LWW-register, PN-counter,
causal garbage collection, and virtual network fault semantics. TCP packet
overhead, retransmission behavior, authentication, and production retail
field-level conflict resolution are outside this milestone's supported claims.

See [DISTRIBUTED_SYNCHRONIZATION_ARCHITECTURE_AUDIT.md](./DISTRIBUTED_SYNCHRONIZATION_ARCHITECTURE_AUDIT.md),
[src/backend/RESEARCH_PROTOCOL.md](./src/backend/RESEARCH_PROTOCOL.md), and
[docs/EXPERIMENTAL_METHODOLOGY.md](./docs/EXPERIMENTAL_METHODOLOGY.md).
The runtime limitation and actual Docker availability are recorded in
[docs/DOCKER_VALIDATION_REPORT.md](./docs/DOCKER_VALIDATION_REPORT.md).
