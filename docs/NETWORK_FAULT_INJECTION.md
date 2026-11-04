# Network fault-injection matrix

## Architecture boundary

The current process-level application has independent HTTP backends. It does
not implement automatic replica-to-replica replication or a central server
fanout protocol. Therefore Docker network controls can validate endpoint
availability, disconnection, restart, and recovery, but cannot demonstrate
automatic propagation of writes made to an isolated backend. Reconnection in
the current runner explicitly resubmits the deterministic operation schedule.

The in-process CRDT simulator remains the supported mechanism for modeled
delay, loss, duplication, reordering, partitions, and long-offline behavior.
Those are not TCP packet measurements.

## Scenario matrix

| Scenario | Mechanism | Supported evidence | Result status |
|---|---|---|---|
| Normal synchronization | Runner operation replay | Semantic state and operation preservation | Locally executed; Docker pending |
| Server disconnection | Docker network disconnect | Requests fail while disconnected; recovery after reconnect | Docker pending |
| Replica disconnection | Docker network disconnect | Endpoint isolation and restartability | Docker pending |
| Concurrent writes | Local writes before replay | Deterministic operation preservation | Locally executed |
| Reconnection | Explicit replay schedule | Final semantic convergence | Locally executed |
| Delay | Simulator virtual delay | CRDT convergence under scheduled delay | Unit/simulator tests |
| Loss | Simulator drop schedule | Modeled loss behavior only | Unit/simulator tests |
| Duplicate delivery | Repeated operation IDs | Duplicate results and no duplicate effects | Locally executed |
| Reordering | Reverse operation schedule | Final semantic convergence | Locally executed |
| Restart | Same file store after process restart | State and replica identity recovery | Locally executed; Docker pending |
| Long offline replica | Simulator partition/reconnect | Metadata and convergence behavior | Unit/simulator tests |

## Reproduction

On a host with Docker Engine and Compose:

```powershell
$env:GIT_COMMIT = (git rev-parse HEAD)
npm run distributed:validate
```

The validation script runs Compose configuration, image build, startup, health
checks, an experiment, replica restart, a network disconnect/reconnect, a
second experiment, logs, and clean shutdown. It does not claim packet-level
loss, delay, bandwidth, or transport retransmission measurements.

For the deterministic in-process model:

```powershell
npm test -- src/backend/sync/simulator.test.ts src/backend/sync/experiment.test.ts
```

## Metric boundaries

- `convergenceTimeMs` is measured from runner start through final state reads
  only when semantic and operation-preservation checks pass.
- `recoveryTimeMs` is `null` in the process runner because it does not restart a
  process.
- `applicationPayloadBytes` is JSON bytes at the application boundary.
- `bandwidthOverheadBytes` and `persistentStorageBytes` are `null` unless a
  transport or filesystem measurement is actually collected.
- CRDT metadata hashes are reported per replica and are not required to match,
  because replica identity and causal bookkeeping are replica-specific.
