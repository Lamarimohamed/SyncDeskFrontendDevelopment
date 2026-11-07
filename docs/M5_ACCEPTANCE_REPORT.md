# M5 MVP acceptance report

## Baseline and commits

Initial M5 baseline:

- Branch: `wip/milestone-2`
- HEAD: `8ebe9cfe8255c1a29631eee414202ed8a724fdc1`
- Working tree: clean

M5 commits created:

1. `c6fbb58` — `docs: audit end-to-end MVP workflows`
2. `2aeb64b` — `feat: expose synchronization stock outcomes`
3. `20e1e91` — `test: validate end-to-end retail workflows`
4. This report commit

## Verified workflows

- Products and categories can be viewed through repository-backed pages.
- Products can be created and edited with domain validation and category
  selection.
- Categories can be created and edited; deletion rejects live product
  references and succeeds after the product is deleted.
- Stock adjustments are retained locally and use the escrow ledger rather than
  browser-created allocation rights.
- Backend stock results are now preserved through `SyncEngine` and displayed
  in the synchronization status page as applied, no-effect, duplicate,
  rejected, or conflict outcomes when the backend returns one.
- Manual synchronization, retry, pending counts, last successful sync, and
  synchronization errors are visible in the existing synchronization pages.
- Offline catalog changes remain in the persisted local pending queue and are
  retried after reconnection.
- Independent runtime replicas converge after retrieving the same backend
  operation log in different orders.
- File-backed backend restart recovery preserves identity, registrations,
  operation IDs, tombstones, and duplicate replay behavior.

## Test evidence

The final full test run executed:

```text
35 test files passed
236 tests passed
```

Additional targeted M5 integration coverage includes:

- Catalog category/product creation and product update.
- Referential-integrity rejection and deletion retry.
- Canonical stock outcome propagation through `BackendApiClient` and
  `SyncEngine`.
- Operation-log paging, duplicate delivery, and independent replica
  convergence.
- Existing offline queue and failed-sync retention tests.

The following validation commands were executed successfully:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Architecture and limitations

- Synchronization is server-mediated. There is no direct replica-to-replica or
  LAN synchronization path.
- Multi-replica evidence is from independent software runtimes and a real HTTP
  backend, not physical devices or browser automation.
- Offline support is limited to operations that the local repository and
  escrow state can safely record. Backend-authorized allocation cannot be
  invented while offline.
- The UI's device list contains explicitly simulated demo peer entries and is
  not live device telemetry.
- Eventual convergence is demonstrated for the tested versioned operation
  set; this is not a claim of strong consistency or real-time synchronization.
- File persistence uses lock-and-rename writes but does not claim
  fsync-level crash consistency, cloud durability, or recovery after deleted
  site/backend data.
- Authentication, authorization, payments, invoicing, POS checkout,
  multi-tenancy, cloud deployment, production-scale performance, and LAN
  peer networking remain intentionally outside the MVP.
- Docker Engine/Compose runtime validation was not available in this
  environment and is not reported as passed.

## Acceptance result

The minimum end-to-end research demonstrator workflow is accepted for the
tested local/browser-storage and backend-mediated software boundaries. The
limitations above remain explicit and prevent this result from being
interpreted as production retail infrastructure or physical-device
validation.
