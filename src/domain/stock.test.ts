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

  it('allocates initial and restored stock rights, allows authorized decrements, and rejects unauthorized or excessive decrements', () => {
    const stock = EscrowedStock.create('server', 3, 'p-coffee:restore')
    expect(stock.availableRights('server')).toBe(3)
    expect(stock.availableRights('browser-a')).toBe(0)

    const allocated = stock.allocate('browser-a', 2)
    expect(allocated).toBe(2)
    expect(stock.availableRights('browser-a')).toBe(2)
    expect(stock.availableRights('server')).toBe(1)
    expect(stock.value()).toBe(3)

    const browserTokens = Object.entries(stock.snapshot().tokens)
      .filter(([, token]) => token.owner === 'browser-a' && !token.consumedBy)
      .map(([tokenId]) => tokenId)
    const serverTokens = Object.entries(stock.snapshot().tokens)
      .filter(([, token]) => token.owner === 'server' && !token.consumedBy)
      .map(([tokenId]) => tokenId)
    expect(browserTokens).toHaveLength(2)
    expect(serverTokens).toHaveLength(1)

    // Unauthorized decrement by unallocated replica or using server's token
    const unauthorized = stock.apply(operation('browser-b', 'unauth-1', 'inventory.decrement', [browserTokens[0]]))
    expect(unauthorized.status).toBe('no-effect')
    const wrongToken = stock.apply(operation('browser-a', 'unauth-2', 'inventory.decrement', [serverTokens[0]]))
    expect(wrongToken.status).toBe('no-effect')
    expect(stock.availableRights('browser-a')).toBe(2)
    expect(stock.value()).toBe(3)

    // Authorized decrement within allocated rights
    const dec1 = stock.apply(operation('browser-a', 'dec-1', 'inventory.decrement', [browserTokens[0]]))
    expect(dec1.status).toBe('applied')
    expect(stock.availableRights('browser-a')).toBe(1)
    expect(stock.value()).toBe(2)

    // Retry same decrement without double consumption
    const retryDec1 = stock.apply(operation('browser-a', 'dec-1', 'inventory.decrement', [browserTokens[0]]))
    expect(retryDec1.status).toBe('duplicate')
    expect(stock.availableRights('browser-a')).toBe(1)
    expect(stock.value()).toBe(2)

    // Excessive decrement (trying to spend both already-spent and remaining token)
    const excessive = stock.apply(operation('browser-a', 'dec-excess', 'inventory.decrement', browserTokens))
    expect(excessive.status).toBe('no-effect')
    expect(stock.availableRights('browser-a')).toBe(1)
    expect(stock.value()).toBe(2)
  })

  it('preserves previous transfers and allocations when restocking', () => {
    const stock = EscrowedStock.create('server', 2, 'p-tea:initial')
    stock.allocate('replica-a', 2)
    expect(stock.availableRights('replica-a')).toBe(2)

    const allocatedTokens = Object.entries(stock.snapshot().tokens)
      .filter(([, token]) => token.owner === 'replica-a')
      .map(([tokenId]) => tokenId)

    // Transfer one allocated token from replica-a to replica-b
    const transfer = stock.apply(
      operation('replica-a', 'op-transfer-1', 'inventory.transfer', [allocatedTokens[0]], {
        transferId: 'tx-1',
        fromReplicaId: 'replica-a',
        toReplicaId: 'replica-b',
      }),
    )
    expect(transfer.status).toBe('applied')
    expect(stock.availableRights('replica-a')).toBe(1)
    expect(stock.availableRights('replica-b')).toBe(1)

    // Restock new tokens on server; must not overwrite replica-b's transferred token back to replica-a
    const restock = stock.apply(
      operation('server', 'op-restock-2', 'inventory.restock', ['restock-token-1', 'restock-token-2']),
    )
    expect(restock.status).toBe('applied')
    expect(stock.availableRights('replica-a')).toBe(1)
    expect(stock.availableRights('replica-b')).toBe(1)
    expect(stock.availableRights('server')).toBe(2)
    expect(stock.value()).toBe(4)

    // replica-b can still spend its transferred token after the restock
    const spendTransferred = stock.apply(
      operation('replica-b', 'op-dec-3', 'inventory.decrement', [allocatedTokens[0]]),
    )
    expect(spendTransferred.status).toBe('applied')
    expect(stock.availableRights('replica-b')).toBe(0)
    expect(stock.value()).toBe(3)
  })
})
