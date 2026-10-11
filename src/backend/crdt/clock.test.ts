import { describe, expect, it } from 'vitest'
import { HybridLogicalClock } from './clock'

describe('hybrid logical clock', () => {
  it('monotonically advances local time', () => {
    const clock = new HybridLogicalClock('n1', 10, 3)
    const t1 = clock.tick(10)
    const t2 = clock.tick(11)

    expect(t1.wallClock).toBe(10)
    expect(t1.logicalCounter).toBe(4)
    expect(t2.wallClock).toBe(11)
    expect(t2.logicalCounter).toBe(0)
  })

  it('orders concurrent events deterministically by node id when clock values match', () => {
    const a = { wallClock: 100, logicalCounter: 7, nodeId: 'n1' }
    const b = { wallClock: 100, logicalCounter: 7, nodeId: 'n2' }

    expect(HybridLogicalClock.compare(a, b)).toBeLessThan(0)
    expect(HybridLogicalClock.compare(b, a)).toBeGreaterThan(0)
  })
})
