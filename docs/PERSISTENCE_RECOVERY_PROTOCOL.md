# Persistence and recovery protocol

The backend uses `FileReplicaStore` when a file path is configured. Writes use a
lock and temporary-file rename; startup validates JSON records before replaying
the durable operation log and rebuilding the versioned projection.

The recovery integration test starts a real backend, persists a product restore,
product tombstone, and replica registration, closes the server, then starts a
new server instance against the same file. It verifies the stable backend
identity, registration count, tombstoned catalog, operation IDs, and duplicate
replay behavior.

Malformed JSON, invalid record shape, lock contention, and stale revision
replacement fail visibly in the persistence unit tests. A missing file is
treated as an empty store for first initialization; site data or the backend
file being deleted is not claimed to be recoverable. The file store does not
provide a multi-file transaction or fsync-level crash guarantee.
