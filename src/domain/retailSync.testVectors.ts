import type { RetailVersion } from './retailSync'

export const retailVersionOrderingVectors = [
  {
    name: 'logical time takes precedence',
    left: { logicalTime: 2, replicaId: 'a', operationId: 'later' },
    right: { logicalTime: 1, replicaId: 'z', operationId: 'earlier' },
    expected: 1,
  },
  {
    name: 'replica identifier breaks ties',
    left: { logicalTime: 2, replicaId: 'a', operationId: 'same-time' },
    right: { logicalTime: 2, replicaId: 'b', operationId: 'same-time' },
    expected: -1,
  },
  {
    name: 'operation identifier breaks ties',
    left: { logicalTime: 2, replicaId: 'a', operationId: 'operation-b' },
    right: { logicalTime: 2, replicaId: 'a', operationId: 'operation-a' },
    expected: 1,
  },
  {
    name: 'ASCII z precedes accented e in UTF-8 order',
    left: { logicalTime: 2, replicaId: 'a', operationId: 'z' },
    right: { logicalTime: 2, replicaId: 'a', operationId: 'é' },
    expected: -1,
  },
  {
    name: 'ASCII z precedes non-BMP emoji in UTF-8 order',
    left: { logicalTime: 2, replicaId: 'a', operationId: '😀' },
    right: { logicalTime: 2, replicaId: 'a', operationId: 'z' },
    expected: 1,
  },
] satisfies ReadonlyArray<{
  name: string
  left: RetailVersion
  right: RetailVersion
  expected: -1 | 1
}>
