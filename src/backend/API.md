# SyncDesk Backend HTTP API

This is a backend-only HTTP server for the existing generic CRDT replica
implementation. It does not connect to the React frontend, expose retail
product endpoints, or provide peer-to-peer replication.

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

Example with file-backed state:

```powershell
$env:BACKEND_STORE_PATH = "$PWD\.tmp\backend-replicas.json"
node --experimental-transform-types --loader ./src/backend/api/ts-loader.mjs src/backend/api/server.ts
```

File persistence is atomic at the single-file rename operation used by the
existing class, but it does not provide cross-process locking or a claim of
crash durability.

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

- This API exposes generic CRDT state, not the frontend's products,
  categories, stock, or authentication domain.
- It does not modify or import `MockRepository`, browser storage, or the
  frontend `SyncEngine`.
- HTTP submission to one server does not prove multi-replica convergence.
- There is no WebSocket, TCP peer transport, authentication, CORS policy,
  multi-tenant isolation, or offline client queue in this milestone.
- In-memory state is lost when the process exits.
- File-backed state can be selected by backend composition code, but
  cross-process safety and crash durability are not claimed.
