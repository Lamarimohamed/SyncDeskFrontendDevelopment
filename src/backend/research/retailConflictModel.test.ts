import { describe, expect, it } from 'vitest'
import { ReplicaRuntime } from '../crdt/replica'
import { LwwRegister } from '../crdt/lwwRegister'

const converge = (replicas: ReplicaRuntime<string>[]): void => {
  for (const source of replicas) {
    for (const target of replicas) {
      if (source !== target) target.merge(source)
    }
  }
}

describe('retail conflict-model capability fixtures', () => {
  it('merges concurrent inventory deltas deterministically with a PN-counter', () => {
    const a = new ReplicaRuntime<string>('a')
    const b = new ReplicaRuntime<string>('b')
    a.incrementCounter(2)
    b.incrementCounter(3)

    a.merge(b)
    b.merge(a)

    expect(a.counter.value()).toBe(5)
    expect(b.counter.value()).toBe(5)
    expect(a.snapshot().counter).toEqual(b.snapshot().counter)
  })

  it('keeps OR-Set operation markers stable under duplicate and reordered state delivery', () => {
    const a = new ReplicaRuntime<string>('a')
    const b = new ReplicaRuntime<string>('b')
    const c = new ReplicaRuntime<string>('c')
    a.add('product-upsert-1')
    b.add('product-upsert-2')
    c.add('product-delete-1')

    converge([a, b, c])
    a.merge(b)
    c.merge(a)

    expect(a.snapshot().set).toEqual(b.snapshot().set)
    expect(b.snapshot().set).toEqual(c.snapshot().set)
    expect(a.set.values().sort()).toEqual(['product-delete-1', 'product-upsert-1', 'product-upsert-2'])
  })

  it('resolves equal-time LWW writes deterministically by replica identity', () => {
    const a = new LwwRegister<string>('a')
    const b = new LwwRegister<string>('b')
    a.write('field-from-a', 100)
    b.write('field-from-b', 100)

    a.merge(b)
    b.merge(a)

    expect(a.toJSON()).toEqual(b.toJSON())
    expect(a.value).toBe('field-from-b')
  })

  it('documents the current product-model boundary: one register cannot preserve independent fields', () => {
    const replica = new ReplicaRuntime<string>('a')
    replica.writeRegister('product-name')
    replica.writeRegister('product-price')

    expect(replica.register.value).toBe('product-price')
    expect(replica.register.value).not.toContain('product-name')
  })
})
