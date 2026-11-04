# Docker validation report

## Repository audit

- Expected baseline: `97628a3`; the validation session must verify `git rev-parse
  HEAD` before execution.
- The backend accepts `BACKEND_REPLICA_ID`, persists the generic and retail
  records through `FileReplicaStore`, and uses atomic temporary-file replacement
  plus a lock file.
- The Compose topology has three independent services and volumes. The
  experiment runner now reads the complete retail state endpoint, checks
  catalog fields and deletion effects, verifies operation IDs, and reports raw
  CRDT metadata hashes separately.

## Runtime status

Docker was not available in the validation environment. The commands
`docker --version` and `docker compose version` failed with PowerShell's
`docker : The term 'docker' is not recognized` error. Therefore no Docker
build, container startup, health check, restart, network disconnect, or Compose
log result is claimed here. The exact validation command
`npm run distributed:validate` was also executed and stopped at
`scripts/validate-docker.ps1:3` for the same reason.

Run the complete external validation from the repository root on a host with
Docker Engine and Compose:

```text
npm run distributed:validate
```

The script executes `docker compose config`, `build`, `up`, `ps`, per-replica
health checks, the experiment, a replica restart, a temporary Docker network
disconnect/reconnect, a second experiment, logs, and clean shutdown. It fails
on any unsuccessful command.

## Supported failure semantics

The current application synchronizes through independent HTTP servers. It does
not implement replica-to-replica LAN synchronization. A Docker network
disconnect can therefore validate server unavailability and recovery, but it
cannot prove that writes made to an isolated server automatically flow to
another server. The runner's reconnect phase explicitly resubmits the
operation set, making that limitation observable rather than hiding it.

Delayed and duplicate delivery are validated at the application-operation
boundary by deterministic reverse-order replay and repeated operation IDs.
CRDT-level delay, loss, reordering, restart, and garbage-collection behavior
remain covered by the existing in-process tests and simulator.

## OR-Set GC

The OR-Set implements causal-stability collection under static membership.
Collection remains blocked while an offline member has not observed the remove
event. Existing tests cover delayed members, concurrent re-adds, restart
watermarks, merge-order convergence, and no resurrection after collection.
The Docker retail endpoint does not expose OR-Set GC as a production catalog
operation, so no Docker GC metric is claimed.

## Non-Docker evidence

The application test suite currently passes with 29 test files and 186 tests,
and TypeScript typechecking passes. The local process-level runner has also
validated unique replica identities, complete catalog convergence, deletion
semantics, duplicate suppression, operation preservation, and recovery from the
same persisted store. These results do not substitute for Docker Engine
validation.

The runner reports recovery time as `null` because its process-level scenario
does not stop and restart a replica; restart recovery is only measured by the
Docker validation script when Docker is available.

Each result records `softwareVersion` and `gitCommit`. If the configured output
path already exists, the runner writes a run-ID-suffixed file instead of
overwriting the previous result.

## Actual local process run

Using Node.js `v24.21.0`, seed `20261103`, configuration
`docs/distributed-experiment.config.example.json`, and commit
`97628a32181f25bf9bf9e7c90e68b0edf12f927d`, the three-process runner completed
successfully:

- replicas: `replica-a`, `replica-b`, `replica-c`
- operations generated: `4`
- operations transmitted: `24`
- operations applied: `9`
- operations deduplicated: `15`
- experiment/convergence time: `194 ms`
- semantic correctness: `true`
- operation preservation: `true`
- final correctness: `true`
- application payload bytes: `1304`
- state bytes: `1926`
- bandwidth overhead: `null`
- persistent storage bytes: `null`

This is process-level HTTP evidence, not Docker evidence. The raw output was
inspected and temporary local output was removed; no experimental result was
overwritten.
