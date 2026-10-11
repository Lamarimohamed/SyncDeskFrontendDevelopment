import { describe, expect, it } from 'vitest'
import { LwwRegister } from './lwwRegister'

describe('lww register', () => {
  it('keeps the newest value after merge', () => {
    const left = new LwwRegister<string>('a')
    const right = new LwwRegister<string>('b')

    left.write('v1', 100)
    right.write('v2', 200)
    left.merge(right)

    expect(left.value).toBe('v2')
  })

  it('preserves the local winner when timestamps tie and nodeIds break the tie', () => {
    const left = new LwwRegister<string>('a')
    const right = new LwwRegister<string>('b')

    left.write('v1', 150)
    right.write('v2', 150)

    const merged = new LwwRegister<string>('a')
    merged.merge(left)
    merged.merge(right)
    expect(merged.value).toBe('v2')
  })
})
