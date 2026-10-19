# SyncDesk Backend HTTP API

This HTTP server exposes the existing generic CRDT replica implementation and a
small authoritative retail operation API. It does not provide peer-to-peer
replication.

The frontend integration is opt-in through `VITE_BACKEND_URL`. When configured,
The browser keeps its existing local repository and offline queue. Product and
category mutations are sent as idempotent retail operations before the generic
sync envelope is submitted. Stock mutations still use only the generic
PN-counter envelope and are not represented as backend inventory records.

## Start

The server entry point is `src/backend/api/server.ts`. It assumes Node.js 24 or
newer because the repository currently uses TypeScript source imports and Node's
built-in type transformation support. From the repository root, start it with:

```powershell
node --experimental-transform-types --loader ./src/backend/api/ts-loader.mjs src/backend/api/server.ts
```

The loader only resolves the repository's existing extensionless relative
TypeScript imports; it is not a package or a shared build configuration.

Environment variables:

- `BACKEND_HOST` defaults to `127.0.0.1`.
- `BACKEND_PORT` defaults to `8787`; port `0` selects an available port for
  tests.
- `BACKEND_STORE_PATH` is optional. When it is a non-empty path, the standalone
  server uses the existing file-backed replica store. When unset or blank, the
  server uses in-memory storage and all state is lost on process exit.
- `BACKEND_CORS_ORIGIN` defaults to `*` for local development. Set it to the
  exact frontend origin when a restricted deployment is required.

Example with file-backed state:

```powershell
$env:BACKEND_STORE_PATH = "$PWD\.tmp\backend-replicas.json"
node --experimental-transform-types --loader ./src/backend/api/ts-loader.mjs src/backend/api/server.ts
```

File persistence is atomic at the single-file rename operation used by the
existing class, but it does not provide cross-process locking or a claim of
crash durability.

The migration foundation also exposes a revision-checked replacement boundary
for the retail record. It validates the complete V2 record before replacement
and uses a sidecar lock file to serialize file-backed mutations across
independent processes. Reads remain unlocked. A stale revision is rejected
while the write lock is held. The lock is not crash-recoverable: a process
that dies while holding it can leave a lock file requiring operator cleanup.
This boundary does not make the existing V1 runtime use V2 records; that
remains future migration work.

## Endpoints

### `GET /health`

Response:

```json
{
  "status": "ok",
  "apiVersion": "1"
}
```

### `GET /v1/replica`

Returns the server-owned generic CRDT snapshot. An empty server starts with a
register containing `null`, an empty OR-Set, and an empty PN-Counter.

```json
{
  "replicaId": "backend-replica",
  "persisted": false,
  "updatedAt": null,
  "snapshot": {
    "replicaId": "backend-replica",
    "clock": {
      "wallClock": 0,
      "logicalCounter": 0,
      "nodeId": "backend-replica"
    },
    "register": {
      "value": null,
      "timestamp": {
        "wallClock": 0,
        "logicalCounter": 0,
        "nodeId": "backend-replica"
      }
    },
    "set": {
      "adds": {},
      "removes": {}
    },
    "counter": {
      "backend-replica": {
        "increment": 0,
        "decrement": 0
      }
    }
  }
}
```

### `POST /v1/sync/messages`

Accepts one existing version-1 `StateSyncMessage` JSON object. The server
validates it with `validateStateMessage`, merges its snapshot with the
server-owned `ReplicaRuntime`, records the message ID for deduplication, and
returns the existing acknowledgement type.

Example request:

```json
{
  "type": "state",
  "protocol": "syncdesk-state",
  "version": 1,
  "messageId": "message-1",
  "fromReplicaId": "client-a",
  "snapshot": {}
}
```

The `snapshot` must be a complete valid `ReplicaSnapshot`; the abbreviated
example above is illustrative only and will be rejected.

Example successful response shape:

```json
{
  "applied": true,
  "acknowledgement": {
    "type": "ack",
    "protocol": "syncdesk-state",
    "version": 1,
    "messageId": "message-1",
    "fromReplicaId": "backend-replica",
    "status": "applied"
  },
  "replicaId": "backend-replica",
  "snapshot": {},
  "persistedAt": 1760000000000
}
```

Submitting the same `messageId` again returns HTTP `200` with
`acknowledgement.status` set to `duplicate` and does not merge the message a
second time.

### `GET /v1/retail/catalog`

Returns the backend's persisted authoritative product/category projection.

### `POST /v1/retail/operations`

Accepts `{ "operations": [...] }` containing product/category upserts and
deletes. Each operation has an `operationId`; repeated IDs return `duplicate`
without applying the operation again. A successful response is sent only after
the candidate catalog and its CRDT operation marker have been persisted.

| UI operation | Backend operation | Representation | Conflict semantics |
| --- | --- | --- | --- |
| Create/edit product | `product.upsert` | Whole validated `Product` plus OR-Set marker and PN-counter increment | Authoritative last received whole-record write; no multi-replica merge claim |
| Delete product | `product.delete` | Product ID plus OR-Set marker | Authoritative removal; no tombstone exchange between replicas |
| Create/edit category | `category.upsert` | Whole validated `Category` plus OR-Set marker and PN-counter increment | Authoritative last received whole-record write |
| Delete category | `category.delete` | Category ID plus OR-Set marker | Authoritative removal; product-reference validation remains frontend-local |
| Stock adjustment | Not supported by retail API | Existing generic PN-counter envelope only | No backend stock projection or inventory guarantee |

The OR-Set marker and counter provide durable operation accounting using the
existing CRDT types. They do not make the catalog itself a multi-replica CRDT.

## Errors and limits

Errors use this shape:

```json
{
  "error": {
    "code": "invalid_sync_message",
    "message": "Invalid or unsupported sync message"
  }
}
```

Current status codes:

- `400` malformed JSON or invalid/unsupported synchronization message.
- `503` valid synchronization message could not be persisted.
- `404` unknown route.
- `413` request body exceeds the 1 MiB default limit.

`OPTIONS` requests receive a `204` response for browser preflight. The server
allows `GET`, `POST`, and `content-type` from the configured CORS origin.
- `500` unexpected processing failure.

Persistence failures use this stable response and do not expose the underlying
store error:

```json
{
  "error": {
    "code": "persistence_failed",
    "message": "The synchronization update could not be persisted."
  }
}
```

The server does not return stack traces, filesystem paths, or internal
exception text in HTTP responses. A valid message is applied to a candidate
replica and candidate deduplication set first. The candidate is persisted
before it replaces the live endpoint, so a failed `save` does not publish the
candidate in the server process. This is an in-process publish-after-save
boundary; the existing store interface cannot guarantee rollback if a store
reports failure after partially writing externally.
Requests that modify state are serialized within one server instance to avoid
interleaving store reads and writes. This does not provide multi-process
locking.

## Test with PowerShell

Run the backend API tests using the existing test tooling:

```powershell
npx vitest run src/backend/api/server.test.ts
```

The tests start a real local HTTP listener, issue HTTP requests, and close it
after each case. They use isolated in-memory server state.

## Scope and limitations

- Retail catalog persistence is authoritative single-server state. It is not
  a multi-replica catalog merge.
- On startup with `VITE_BACKEND_URL`, the frontend requests the backend catalog
  and hydrates local product/category data. The backend catalog is authoritative
  for records without pending local changes. Pending product/category entities
  always win locally and are not overwritten. Non-pending local records absent
  from the backend are removed; remote product deletions are retained as local
  tombstones. Repeating hydration is idempotent.
- If the backend is unavailable or returns malformed catalog data, startup
  keeps the existing local data and logs a repository warning.
- Stock adjustments are not backend retail records.
- The frontend bridge adds retail operation payloads to the existing
  `MockRepository` pending queue; it does not replace that local repository or
  the frontend `SyncEngine`.
- HTTP submission to one server does not prove multi-replica convergence.
- There is no WebSocket, TCP peer transport, authentication, or multi-tenant
  isolation in this milestone. CORS is limited to the configured development
  origin setting.
- In-memory state is lost when the process exits.
- File-backed state can be selected by backend composition code, but
  cross-process safety and crash durability are not claimed.

## Frontend development

Start the backend first:

```powershell
$env:BACKEND_STORE_PATH = "$PWD\.tmp\backend-replicas.json"
node --experimental-transform-types --loader ./src/backend/api/ts-loader.mjs src/backend/api/server.ts
```

Then start Vite with the backend URL:

```powershell
$env:VITE_BACKEND_URL = "http://127.0.0.1:8787"
npm run dev
```

If `VITE_BACKEND_URL` is unset, the frontend retains its existing local-only
simulated synchronization behavior. If the backend becomes unavailable during
a configured sync, the local pending changes remain pending/failed and the UI
shows the synchronization error; they are not discarded.
