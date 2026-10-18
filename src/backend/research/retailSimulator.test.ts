import { describe, expect, it } from 'vitest'
import type { Product } from '../../domain/types'
import type { Category } from '../../domain/types'
import { RetailReplicaSimulator, type RetailSimulationOperation } from './retailSimulator'

const product: Product = {
  id: 'p1',
  name: 'Tea',
  nameAr: 'شاي',
  description: 'Green tea',
  descriptionAr: 'شاي أخضر',
  price: 10,
  categoryId: 'c1',
  availability: 'available',
  lowStockThreshold: 2,
  stock: 10,
  updatedAt: 1767225600000,
}

const category: Category = {
  id: 'c1',
  name: 'Drinks',
  nameAr: 'مشروبات',
  description: 'Beverages',
  updatedAt: 1767225600000,
}

const op = (operation: RetailSimulationOperation): RetailSimulationOperation => operation
const version = (operationId: string, replicaId: 'A' | 'B' | 'C', logicalTime: number) => ({
  operationId,
  replicaId,
  logicalTime,
})

const runSameFieldSchedule = (model: 'baseline' | 'candidate') => {
  const simulator = new RetailReplicaSimulator({ products: [product] }, model)
  const nameA = op({
    operationId: 'a-name',
    origin: 'A',
    kind: 'product.field.update',
    productId: 'p1',
    field: 'name',
    value: 'Coffee',
    ...(model === 'candidate' ? { version: version('a-name', 'A', 10) } : {}),
  })
  const nameB = op({
    operationId: 'b-name',
    origin: 'B',
    kind: 'product.field.update',
    productId: 'p1',
    field: 'name',
    value: 'Espresso',
    ...(model === 'candidate' ? { version: version('b-name', 'B', 10) } : {}),
  })
  simulator.local('A', nameA)
  simulator.local('B', nameB)
  simulator.queue('a-name', 'A', 'C')
  simulator.queue('b-name', 'B', 'C')
  simulator.queue('b-name', 'B', 'A')
  simulator.queue('a-name', 'A', 'B')
  simulator.deliverAll()
  return simulator.report()
}

describe('deterministic retail simulator', () => {
  it('runs the same schedule against baseline and candidate models', () => {
    expect(runSameFieldSchedule('baseline').metrics.converged).toBe(false)
    expect(runSameFieldSchedule('candidate').metrics.converged).toBe(true)
  })

  it('preserves independent operations and records deterministic transfer metrics', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] })
    simulator.local('A', op({ operationId: 'a-name', origin: 'A', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee' }))
    simulator.local('B', op({ operationId: 'b-price', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'price', value: 12 }))
    simulator.queue('a-name', 'A', 'B')
    simulator.queue('a-name', 'A', 'C')
    simulator.queue('b-price', 'B', 'A')
    simulator.queue('b-price', 'B', 'C')
    simulator.deliverAll()

    const report = simulator.report()
    expect(report.states.A.products[0]).toMatchObject({ name: 'Coffee', price: 12 })
    expect(report.states.B.products[0]).toMatchObject({ name: 'Coffee', price: 12 })
    expect(report.metrics.generatedOperations).toBe(2)
    expect(report.metrics.deliveries).toBe(4)
    expect(report.metrics.bytesTransferred).toBeGreaterThan(0)
    expect(report.metrics.converged).toBe(true)
  })

  it('demonstrates order-sensitive same-field and delete-versus-update behavior', () => {
    const sameFieldFirst = new RetailReplicaSimulator({ products: [product] })
    const sameFieldSecond = new RetailReplicaSimulator({ products: [product] })
    const nameA = op({ operationId: 'a-name', origin: 'A', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee' })
    const nameB = op({ operationId: 'b-name', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Espresso' })
    for (const simulator of [sameFieldFirst, sameFieldSecond]) {
      simulator.local('A', nameA)
      simulator.local('B', nameB)
    }
    sameFieldFirst.queue('a-name', 'A', 'C')
    sameFieldFirst.queue('b-name', 'B', 'C')
    sameFieldSecond.queue('b-name', 'B', 'C')
    sameFieldSecond.queue('a-name', 'A', 'C')
    sameFieldFirst.deliverAll()
    sameFieldSecond.deliverAll()
    expect(sameFieldFirst.state('C').products[0].name).toBe('Espresso')
    expect(sameFieldSecond.state('C').products[0].name).toBe('Coffee')

    const first = new RetailReplicaSimulator({ products: [product] })
    const second = new RetailReplicaSimulator({ products: [product] })
    const update = op({ operationId: 'b-update', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee' })
    const deletion = op({ operationId: 'a-delete', origin: 'A', kind: 'product.delete', productId: 'p1' })
    first.local('A', deletion)
    first.local('B', update)
    second.local('A', deletion)
    second.local('B', update)
    first.queue('a-delete', 'A', 'C')
    first.queue('b-update', 'B', 'C')
    second.queue('b-update', 'B', 'C')
    second.queue('a-delete', 'A', 'C')
    first.deliverAll()
    second.deliverAll()

    expect(first.state('C').products).toHaveLength(1)
    expect(second.state('C').products).toHaveLength(0)
    expect(first.report().metrics.converged).toBe(false)
  })

  it('deduplicates delivery, supports explicit reordering, and reports metadata growth', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] })
    simulator.local('A', op({ operationId: 'a-delete', origin: 'A', kind: 'product.delete', productId: 'p1' }))
    simulator.queue('a-delete', 'A', 'B', { duplicate: true, delay: 2 })
    simulator.deliverAll()

    const report = simulator.report()
    expect(report.states.B.products).toEqual([])
    expect(report.states.B.appliedOperationIds).toEqual(['a-delete'])
    expect(report.metrics.duplicateDeliveries).toBe(1)
    expect(report.metrics.finalMetadataCounts.B).toBe(1)
  })

  it('keeps restoration explicit and separates counter convergence from overselling', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] })
    simulator.local('A', op({ operationId: 'a-sale', origin: 'A', kind: 'inventory.adjust', productId: 'p1', delta: -2 }))
    simulator.local('B', op({ operationId: 'b-sale', origin: 'B', kind: 'inventory.adjust', productId: 'p1', delta: -2 }))
    simulator.queue('a-sale', 'A', 'B')
    simulator.queue('b-sale', 'B', 'A')
    simulator.queue('a-sale', 'A', 'C')
    simulator.queue('b-sale', 'B', 'C')
    simulator.deliverAll()

    const report = simulator.report()
    expect(report.states.C.inventoryDeltas.p1).toBe(-4)
    expect(report.metrics.converged).toBe(true)
    expect(report.states.C.inventoryDeltas.p1).toBeLessThan(-product.lowStockThreshold)
  })

  it('does not deliver operations across a partition until explicitly reconnected', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] })
    simulator.local('A', op({ operationId: 'a-restore', origin: 'A', kind: 'product.restore', product: { ...product, name: 'Restored tea' } }))
    simulator.partition('B')
    simulator.queue('a-restore', 'A', 'B')
    expect(simulator.state('B').products[0].name).toBe('Tea')
    simulator.reconnectAndDeliverAll()
    expect(simulator.state('B').products[0].name).toBe('Restored tea')
  })

  it('reconnects three partitioned replicas and converges after the full schedule', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] })
    simulator.local('A', op({ operationId: 'a-name', origin: 'A', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee' }))
    simulator.local('B', op({ operationId: 'b-price', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'price', value: 12 }))
    simulator.partition('A')
    simulator.partition('B')
    simulator.partition('C')
    simulator.queue('a-name', 'A', 'B')
    simulator.queue('b-price', 'B', 'C')
    expect(simulator.report().metrics.converged).toBe(false)
    simulator.reconnectAndDeliverAll()
    simulator.queue('a-name', 'A', 'C')
    simulator.queue('b-price', 'B', 'A')
    simulator.queue('b-price', 'B', 'C')
    simulator.queue('a-name', 'A', 'B')
    simulator.deliverAll()
    expect(simulator.report().metrics.converged).toBe(true)
  })

  it('candidate model resolves fields deterministically regardless of delivery order', () => {
    const first = new RetailReplicaSimulator({ products: [product] }, 'candidate')
    const second = new RetailReplicaSimulator({ products: [product] }, 'candidate')
    const nameA = op({ operationId: 'a-name', origin: 'A', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee', version: version('a-name', 'A', 10) })
    const priceB = op({ operationId: 'b-price', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'price', value: 12, version: version('b-price', 'B', 10) })
    first.local('A', nameA)
    first.local('B', priceB)
    second.local('A', nameA)
    second.local('B', priceB)
    for (const simulator of [first, second]) {
      simulator.queue('a-name', 'A', 'C')
      simulator.queue('b-price', 'B', 'C')
    }
    second.deliverNext()
    second.deliverNext()
    first.deliverNext()
    first.deliverNext()

    expect(first.state('C').products[0]).toMatchObject({ name: 'Coffee', price: 12 })
    expect(second.state('C').products[0]).toEqual(first.state('C').products[0])
  })

  it('candidate model uses replica identity as a deterministic same-field tie-break', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] }, 'candidate')
    simulator.local('A', op({ operationId: 'a-name', origin: 'A', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee', version: version('a-name', 'A', 10) }))
    simulator.local('B', op({ operationId: 'b-name', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Espresso', version: version('b-name', 'B', 10) }))
    simulator.queue('b-name', 'B', 'C')
    simulator.queue('a-name', 'A', 'C')
    simulator.deliverAll()

    expect(simulator.state('C').products[0].name).toBe('Espresso')
  })

  it('candidate model makes delete win over concurrent update and requires explicit restoration', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] }, 'candidate')
    simulator.local('A', op({ operationId: 'a-delete', origin: 'A', kind: 'product.delete', productId: 'p1', version: version('a-delete', 'A', 20) }))
    simulator.local('B', op({ operationId: 'b-update', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee', version: version('b-update', 'B', 20) }))
    simulator.queue('b-update', 'B', 'C')
    simulator.queue('a-delete', 'A', 'C')
    simulator.deliverAll()
    expect(simulator.state('C').products).toEqual([])

    simulator.local('A', op({ operationId: 'a-restore', origin: 'A', kind: 'product.restore', product: { ...product, name: 'Restored tea' }, version: version('a-restore', 'A', 30) }))
    simulator.queue('a-restore', 'A', 'C')
    simulator.queue('a-delete', 'A', 'C', { duplicate: true })
    simulator.deliverAll()
    expect(simulator.state('C').products[0].name).toBe('Restored tea')
  })

  it('candidate model converges after duplicate, reordered three-replica partition delivery', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] }, 'candidate')
    const name = op({ operationId: 'a-name', origin: 'A', kind: 'product.field.update', productId: 'p1', field: 'name', value: 'Coffee', version: version('a-name', 'A', 10) })
    const price = op({ operationId: 'b-price', origin: 'B', kind: 'product.field.update', productId: 'p1', field: 'price', value: 12, version: version('b-price', 'B', 10) })
    simulator.local('A', name)
    simulator.local('B', price)
    simulator.partition('A')
    simulator.partition('B')
    simulator.partition('C')
    simulator.queue('a-name', 'A', 'C', { duplicate: true, delay: 2 })
    simulator.queue('b-price', 'B', 'C', { delay: 1 })
    expect(simulator.report().metrics.converged).toBe(false)
    simulator.reconnectAndDeliverAll()
    simulator.queue('a-name', 'A', 'B')
    simulator.queue('b-price', 'B', 'A')
    simulator.queue('a-name', 'A', 'C')
    simulator.queue('b-price', 'B', 'C')
    simulator.deliverAll()
    expect(simulator.report().metrics.converged).toBe(true)
    expect(simulator.report().metrics.duplicateDeliveries).toBe(3)
  })

  it('candidate inventory deltas converge without preventing overselling', () => {
    const simulator = new RetailReplicaSimulator({ products: [product] }, 'candidate')
    simulator.local('A', op({ operationId: 'a-sale', origin: 'A', kind: 'inventory.adjust', productId: 'p1', delta: -8, version: version('a-sale', 'A', 10) }))
    simulator.local('B', op({ operationId: 'b-sale', origin: 'B', kind: 'inventory.adjust', productId: 'p1', delta: -8, version: version('b-sale', 'B', 10) }))
    simulator.queue('b-sale', 'B', 'A')
    simulator.queue('a-sale', 'A', 'B')
    simulator.queue('a-sale', 'A', 'C')
    simulator.queue('b-sale', 'B', 'C')
    simulator.deliverAll()

    expect(simulator.report().metrics.converged).toBe(true)
    expect(simulator.state('C').inventoryDeltas.p1).toBe(-16)
    expect(simulator.state('C').inventoryDeltas.p1 + product.stock).toBeLessThan(0)
  })

  it('candidate model merges category fields independently', () => {
    const simulator = new RetailReplicaSimulator({ categories: [category] }, 'candidate')
    simulator.local('A', op({
      operationId: 'a-category-name',
      origin: 'A',
      kind: 'category.field.update',
      categoryId: 'c1',
      field: 'name',
      value: 'Hot drinks',
      version: version('a-category-name', 'A', 10),
    }))
    simulator.local('B', op({
      operationId: 'b-category-description',
      origin: 'B',
      kind: 'category.field.update',
      categoryId: 'c1',
      field: 'description',
      value: 'Served cold or hot',
      version: version('b-category-description', 'B', 10),
    }))
    simulator.queue('b-category-description', 'B', 'C')
    simulator.queue('a-category-name', 'A', 'C')
    simulator.deliverAll()

    expect(simulator.state('C').categories[0]).toMatchObject({
      name: 'Hot drinks',
      description: 'Served cold or hot',
    })
  })
})
