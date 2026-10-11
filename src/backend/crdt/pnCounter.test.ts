import { describe, expect, it } from 'vitest'
import { PnCounter } from './pnCounter'

describe('pn counter', () => {
  it('sums increments and decrements across replicas', () => {
    const a = new PnCounter('a')
    const b = new PnCounter('b')

    a.increment(3)
    b.decrement(2)

    a.merge(b)
    b.merge(a)

    expect(a.value()).toBe(1)
    expect(b.value()).toBe(1)
  })
})
