import { describe, expect, it } from 'vitest'
import { EscrowedStock, type StockOperation } from './stock'

const operation = (
  replicaId: string,
  operationId: string,
  kind: StockOperation['kind'],
  tokenIds: string[],
  extra: Partial<StockOperation> = {},
): StockOperation => ({
  operationId,
  productId: 'p',
  replicaId,
  version: { logicalTime: Number(operationId.replace(/\D/g, '') || 1), replicaId, operationId },
  kind,
  tokenIds,
  ...extra,
} as StockOperation)

describe('EscrowedStock', () => {
  it('conserves rights while independent replicas decrement', () => {
    const first = EscrowedStock.create('a', 2, 'seed')
    const tokens = Object.keys(first.snapshot().tokens)
    first.apply(operation('a', '1', 'inventory.decrement', [tokens[0]]))
    first.apply(operation('a', '2', 'inventory.transfer', [tokens[1]], {
      transferId: 'transfer-1',
      fromReplicaId: 'a',
      toReplicaId: 'b',
    }))
    const second = new EscrowedStock('b', first.stateSnapshot())
    second.apply(operation('b', '3', 'inventory.decrement', [tokens[1]]))
    expect(second.value()).toBe(0)
    expect(Object.values(second.snapshot().availableRights).reduce((sum, value) => sum + value, 0)).toBe(0)
  })

  it('rejects local exhaustion before creating a decrement', () => {
    const stock = EscrowedStock.create('a', 1, 'seed')
    const token = Object.keys(stock.snapshot().tokens)[0]
    stock.apply(operation('a', 'dec', 'inventory.decrement', [token]))
    expect(stock.availableRights('a')).toBe(0)
    expect(stock.apply(operation('a', 'zbad', 'inventory.decrement', [token])).status).toBe('no-effect')
    expect(stock.value()).toBe(0)
  })

  it('is idempotent and converges for delayed transfer delivery', () => {
    const initial = EscrowedStock.create('a', 1, 'seed')
    const token = Object.keys(initial.snapshot().tokens)[0]
    const transfer = operation('a', 'transfer', 'inventory.transfer', [token], {
      transferId: 'transfer-1',
      fromReplicaId: 'a',
      toReplicaId: 'b',
    })
    const decrement = operation('b', 'dec', 'inventory.decrement', [token])
    const first = new EscrowedStock('a', initial.stateSnapshot())
    first.apply(decrement)
    first.apply(transfer)
    const second = new EscrowedStock('a', initial.stateSnapshot())
    second.apply(transfer)
    second.apply(decrement)
    expect(first.snapshot()).toEqual(second.snapshot())
    expect(first.apply(transfer).status).toBe('duplicate')
  })

  it('replays restock and operations deterministically', () => {
    const stock = EscrowedStock.create('a', 0, 'seed')
    const restock = operation('a', 'restock-1', 'inventory.restock', ['new-token'])
    stock.apply(restock)
    const replay = new EscrowedStock('a', stock.stateSnapshot())
    expect(replay.value()).toBe(1)
    expect(replay.apply(restock).status).toBe('duplicate')
  })

  it('reports rejected, no-effect, and conflicting outcomes without mutation', () => {
    const stock = EscrowedStock.create('a', 1, 'seed')
    const token = Object.keys(stock.snapshot().tokens)[0]
    const malformed = operation('a', 'malformed', 'inventory.decrement', [])
    const rejected = stock.apply(malformed)
    expect(rejected.status).toBe('rejected')
    expect(stock.value()).toBe(1)

    const noEffect = stock.apply(operation('b', 'foreign', 'inventory.decrement', [token]))
    expect(noEffect.status).toBe('no-effect')
    expect(stock.value()).toBe(1)

    const accepted = stock.apply(operation('a', 'conflicting', 'inventory.decrement', [token]))
    expect(accepted.status).toBe('applied')
    const conflict = stock.apply({ ...operation('a', 'conflicting', 'inventory.decrement', []), tokenIds: [] })
    expect(conflict.status).toBe('conflict')
    expect(stock.value()).toBe(0)
  })
})
