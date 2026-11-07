import type { Category, Product } from "../../domain/types"
import { EscrowedStock, type EscrowedStockState, type StockOperation, type StockOperationOutcome } from "../../domain/stock"
import {
  compareRetailVersions,
  type VersionedProductField,
  type VersionedRetailOperation,
} from "../../domain/retailSync"

type ProductRecord = { fields: Product; fieldVersions: Partial<Record<keyof VersionedProductField, VersionedRetailOperation["version"]>>; tombstone?: VersionedRetailOperation["version"]; restoredVersion?: VersionedRetailOperation["version"] }
type CategoryRecord = { fields: Category; fieldVersions: Partial<Record<keyof Category, VersionedRetailOperation["version"]>>; tombstone?: VersionedRetailOperation["version"] }

export interface VersionedRetailRuntimeSnapshot {
  products: Array<[string, ProductRecord]>
  categories: Array<[string, CategoryRecord]>
  inventory: Array<[string, number]>
  appliedOperationIds: string[]
  stocks: Array<[string, EscrowedStockState]>
}

export class VersionedRetailRuntime {
  private readonly replicaId: string
  private readonly applied = new Set<string>()
  private readonly products = new Map<string, ProductRecord>()
  private readonly categories = new Map<string, CategoryRecord>()
  private readonly inventory = new Map<string, number>()
  private readonly stocks = new Map<string, EscrowedStock>()
  private readonly stockOutcomes = new Map<string, StockOperationOutcome>()

  constructor(
    initial: { products: Product[]; categories: Category[] } = { products: [], categories: [] },
    replicaId = "server",
    stockStates: Record<string, EscrowedStockState> = {},
  ) {
    this.replicaId = replicaId
    for (const product of initial.products) {
      this.products.set(product.id, { fields: structuredClone(product), fieldVersions: {} })
      this.stocks.set(
        product.id,
        stockStates[product.id]
          ? new EscrowedStock(replicaId, stockStates[product.id])
          : EscrowedStock.create(replicaId, product.stock, `${product.id}:${replicaId}`),
      )
    }
    for (const category of initial.categories) this.categories.set(category.id, { fields: structuredClone(category), fieldVersions: {} })
  }

  apply(operation: VersionedRetailOperation): "applied" | "duplicate" {
    if (this.applied.has(operation.operationId)) return "duplicate"
    this.validateDomainOperation(operation)
    this.applied.add(operation.operationId)
    const version = operation.version
    if (operation.kind === "product.patch") {
      const record = this.products.get(operation.productId)
      if (record && !record.tombstone)
        for (const [field, value] of Object.entries(operation.changes) as Array<[keyof VersionedProductField, VersionedProductField[keyof VersionedProductField]]>) {
          const previous = record.fieldVersions[field]
          if ((!record.restoredVersion || compareRetailVersions(version, record.restoredVersion) > 0) &&
              (!previous || compareRetailVersions(version, previous) > 0)) {
            record.fields = { ...record.fields, [field]: value }
            record.fieldVersions[field] = version
          }
        }
    } else if (operation.kind === "product.delete") {
      const record = this.products.get(operation.productId)
      if (record && (!record.tombstone || compareRetailVersions(version, record.tombstone) > 0) && (!record.restoredVersion || compareRetailVersions(version, record.restoredVersion) > 0)) record.tombstone = version
    } else if (operation.kind === "product.restore") {
      const record = this.products.get(operation.product.id)
      if (!record || ((!record.tombstone || compareRetailVersions(version, record.tombstone) > 0) &&
          (!record.restoredVersion || compareRetailVersions(version, record.restoredVersion) > 0))) {
        this.products.set(operation.product.id, {
          fields: structuredClone(operation.product),
          fieldVersions: Object.fromEntries(
            (Object.keys(operation.product) as Array<keyof VersionedProductField>).map((field) => [field, version]),
          ),
          restoredVersion: version,
        })
        if (!this.stocks.has(operation.product.id))
          this.stocks.set(operation.product.id, EscrowedStock.create(this.replicaId, operation.product.stock, `${operation.product.id}:restore`))
      }
    } else if (operation.kind === "category.patch") {
      const record = this.categories.get(operation.categoryId)
      if (!record && typeof operation.changes.name === "string") {
        this.categories.set(operation.categoryId, {
          fields: {
            id: operation.categoryId,
            name: operation.changes.name,
            nameAr: operation.changes.nameAr ?? "",
            description: operation.changes.description ?? "",
            updatedAt: version.logicalTime,
          },
          fieldVersions: Object.fromEntries(Object.keys(operation.changes).map((field) => [field, version])),
        })
      } else if (record && (!record.tombstone || compareRetailVersions(version, record.tombstone) > 0)) for (const [field, value] of Object.entries(operation.changes) as Array<[keyof Category, string]>) {
        const previous = record.fieldVersions[field]
        if (!previous || compareRetailVersions(version, previous) > 0) {
          record.fields = { ...record.fields, [field]: value }
          record.fieldVersions[field] = version
        }
      }
    } else if (operation.kind === "category.delete") {
      const record = this.categories.get(operation.categoryId)
      if (record && (!record.tombstone || compareRetailVersions(version, record.tombstone) > 0)) record.tombstone = version
    } else if (operation.kind === "inventory.adjust") {
      const stock = this.stocks.get(operation.productId)
      if (stock) {
        const tokenIds = operation.delta > 0
          ? Array.from({ length: operation.delta }, (_, index) => `${operation.operationId}:${index}`)
          : stock.snapshot().tokens
              ? Object.entries(stock.snapshot().tokens)
                  .filter(([, token]) => token.owner === operation.replicaId && !token.consumedBy)
                  .slice(0, Math.abs(operation.delta))
                  .map(([tokenId]) => tokenId)
              : []
        if (operation.delta > 0) {
          this.stockOutcomes.set(operation.operationId, stock.apply({
            operationId: operation.operationId,
            productId: operation.productId,
            replicaId: operation.replicaId,
            version,
            kind: "inventory.restock",
            tokenIds,
          }))
        } else if (tokenIds.length === Math.abs(operation.delta)) {
          this.stockOutcomes.set(operation.operationId, stock.apply({
            operationId: operation.operationId,
            productId: operation.productId,
            replicaId: operation.replicaId,
            version,
            kind: "inventory.decrement",
            tokenIds,
          }))
        } else {
          this.stockOutcomes.set(operation.operationId, {
            operationId: operation.operationId,
            status: "no-effect",
            reason: "Insufficient rights for decrement",
          })
        }
        this.setStockValue(operation.productId, stock.value())
      }
    } else {
      const stock = this.stocks.get(operation.productId)
      if (stock) {
        this.stockOutcomes.set(operation.operationId, stock.apply(operation as StockOperation))
        this.setStockValue(operation.productId, stock.value())
      }
    }
    return "applied"
  }

  validate(operation: VersionedRetailOperation): void {
    if (!this.applied.has(operation.operationId)) this.validateDomainOperation(operation)
  }

  stockOutcome(operationId: string): StockOperationOutcome | undefined {
    const outcome = this.stockOutcomes.get(operationId)
    return outcome ? structuredClone(outcome) : undefined
  }

  private validateDomainOperation(operation: VersionedRetailOperation): void {
    if (operation.kind === "category.delete") {
      const record = this.categories.get(operation.categoryId)
      if (!record || record.tombstone) throw new Error("Cannot delete a category that does not exist")
      if ([...this.products.values()].some((product) => !product.tombstone && product.fields.categoryId === operation.categoryId))
        throw new Error("Cannot delete a category referenced by products")
    }
  }

  catalog(): { products: Product[]; categories: Category[] } {
    return {
      products: [...this.products.values()].filter((record) => !record.tombstone).map((record) => structuredClone(record.fields)),
      categories: [...this.categories.values()].filter((record) => !record.tombstone).map((record) => structuredClone(record.fields)),
    }
  }

  operationIds(): string[] { return [...this.applied].sort() }

  stockStates(): Record<string, EscrowedStockState> {
    return Object.fromEntries([...this.stocks.entries()].map(([productId, stock]) => [productId, stock.stateSnapshot()]))
  }

  allocateRights(productId: string, replicaId: string, count: number): number {
    const stock = this.stocks.get(productId)
    if (!stock) throw new Error(`Unknown stock product: ${productId}`)
    const allocated = stock.allocate(replicaId, count)
    this.setStockValue(productId, stock.value())
    return allocated
  }

  private setStockValue(productId: string, value: number): void {
    const product = this.products.get(productId)
    if (product && !product.tombstone) product.fields = { ...product.fields, stock: value }
  }

  snapshot(): VersionedRetailRuntimeSnapshot {
    return structuredClone({
      products: [...this.products.entries()].sort(([left], [right]) => left.localeCompare(right)),
      categories: [...this.categories.entries()].sort(([left], [right]) => left.localeCompare(right)),
      inventory: [...this.inventory.entries()].sort(([left], [right]) => left.localeCompare(right)),
      appliedOperationIds: this.operationIds(),
      stocks: [...this.stocks.entries()].map(([productId, stock]) => [productId, stock.stateSnapshot()]),
    })
  }
}
