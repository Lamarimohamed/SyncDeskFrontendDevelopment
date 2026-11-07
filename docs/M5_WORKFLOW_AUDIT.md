# M5 End-to-end workflow audit

## Baseline

- Branch: `wip/milestone-2`
- HEAD: `8ebe9cfe8255c1a29631eee414202ed8a724fdc1`
- The worktree was clean before this audit.
- The M2.1, M2.2, M2.3, M3, and M4 commits are present in the current history.

## Data flow

The verified path is:

`React pages -> Repository -> SyncEngine -> BackendApiClient -> HTTP backend -> VersionedRetailRuntime -> DurableOperationLog -> ReplicaStore`

`MockRepository` persists its local catalog, stock ledger, adjustments, and
version metadata through browser storage. `SyncEngine` persists its pending
queue, cursor, logical clock, installation identity, and activity through the
same storage abstraction.

## Workflow status

| Area | Status | Evidence and limitation |
| --- | --- | --- |
| View products and categories | Implemented and verified | Repository queries and the products/categories pages render persisted local state. |
| Create/edit products | Implemented and verified locally | `ProductEditorPage` validates through `validateProduct`, writes to `MockRepository`, and queues versioned operations. |
| Create/edit categories | Implemented and verified locally | `CategoryModal` and repository mutations queue category patches. |
| Category referential integrity | Implemented and verified | Local deletion rejects referenced categories; canonical versioned and legacy backend paths enforce the same policy. |
| Product deletion and deterministic catalog conflicts | Implemented and tested | Versioned runtime and repository preserve tombstones and deterministic field ordering. |
| View and adjust stock | Partially implemented | The UI records local adjustments and the escrow ledger preserves rights, but the form is optimistic and does not display the canonical backend stock outcome. |
| Backend bootstrap and allocation | Implemented and tested | Registration and stock rights are backend-authorized; browser bootstrap hydrates canonical stock state. |
| Offline catalog edits | Implemented and tested | Local product/category changes are persisted in the pending queue while offline. |
| Offline stock edits | Partially implemented | Local inventory adjustments are retained, but rights requiring backend allocation cannot be invented while offline. |
| Manual synchronization | Implemented and verified | The synchronization page exposes Sync now, retry, offline/online controls, pending count, last successful sync, and errors. |
| Automatic synchronization | Implemented | `SyncEngine` schedules synchronization when enabled and when pending work exists. |
| Backend reachability | Partially implemented | Connectivity is represented by the engine and browser connectivity wiring; an HTTP backend is only used when configured. The UI must not be interpreted as physical network telemetry. |
| Multi-replica convergence | Implemented and tested at HTTP/runtime boundaries | M3 tests use independent runtimes and a real backend, not physical devices or direct peer-to-peer networking. |
| Persistence/restart recovery | Implemented and tested for file-backed backend storage | M4 validates backend restart and replay. Browser storage remains subject to site-data clearing and device loss. |
| User-visible stock outcome | Missing before M5 | Backend responses include stock outcomes, but `SyncEngine` discarded them and the UI had no outcome state. |
| Production-scale durability, authentication, payments, POS, and LAN sync | Deliberately excluded | These are outside the MVP demonstrator scope. |

## Simulated or non-authoritative surfaces

- `DevicesPage` peer entries are demo data and are not evidence of live
  physical devices.
- Existing byte and metadata metrics follow the repository's documented
  provenance and are not production network measurements.
- The architecture is server-mediated. No direct replica-to-replica LAN path
  exists.

## M5 implementation target

The verified gap for this milestone is narrow: preserve the backend's
structured stock-operation outcome through the synchronization engine and show
it in the existing synchronization status surface. Catalog workflows and
offline queue behavior already have working repository and UI paths and should
not be redesigned.
