import { describe, expect, it } from 'vitest'
import { ReplicaStore } from './ReplicaStore'

describe('replica persistence', () => {
  it('writes and restores replica state', () => {
    const store = new ReplicaStore()
    const base = { replicaId: 'r1', value: 'v1' }

    const saved = store.save('r1', base)
    expect(store.load('r1')).toEqual(saved)
  })

  it('loads a stable identity after reinitialization', () => {
    const initial = new Map<string, any>([['r1', { replicaId: 'r1', state: { value: 'v1' }, schemaVersion: 1, updatedAt: 123 }]])
    const store = new ReplicaStore(initial)

    expect(store.load('r1')?.state).toEqual({ value: 'v1' })
  })
})
