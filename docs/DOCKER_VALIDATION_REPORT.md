# Docker validation report

## Repository audit

- Expected baseline: `fd8fb5a`; the validation session must verify `git rev-parse
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
log result is claimed here.

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
