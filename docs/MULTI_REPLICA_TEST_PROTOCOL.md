# Multi-replica integration test protocol

The integration suite uses one real HTTP backend and two independent replica
runtime instances. Each replica has a distinct identity and applies operations
retrieved from the backend operation log to its own runtime; no test mutates a
shared replica object.

The deterministic workload restores one product, concurrently patches its name
and price from different replicas, retrieves the complete operation log, and
asserts complete catalog equality. A second scenario retrieves a one-operation
page twice before advancing its cursor, then retrieves the next page and
replays the submitted operation to verify duplicate delivery is harmless.

These tests demonstrate backend-mediated registration, operation-log paging,
retry-safe replay, and field-level convergence. They do not demonstrate
browser rendering, physical devices, peer-to-peer LAN synchronization, packet
loss, process-kill crash consistency, or production-scale performance.
