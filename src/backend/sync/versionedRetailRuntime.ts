import type { Category, Product } from "../../domain/types"
import {
  compareRetailVersions,
  type VersionedProductField,
  type VersionedRetailOperation,
} from "../../domain/retailSync"

type ProductRecord = { fields: Product; fieldVersions: Partial<Record<keyof VersionedProductField, VersionedRetailOperation["version"]>>; tombstone?: VersionedRetailOperation["version"]; restoredVersion?: VersionedRetailOperation["version"] }
type CategoryRecord = { fields: Category; fieldVersions: Partial<Record<keyof Category, VersionedRetailOperation["version"]>> }

export class VersionedRetailRuntime {
  private readonly applied = new Set<string>()
  private readonly products = new Map<string, ProductRecord>()
  private readonly categories = new Map<string, CategoryRecord>()
  private readonly inventory = new Map<string, number>()

  constructor(initial: { products: Product[]; categories: Category[] } = { products: [], categories: [] }) {
    for (const product of initial.products) this.products.set(product.id, { fields: structuredClone(product), fieldVersions: {} })
    for (const category of initial.categories) this.categories.set(category.id, { fields: structuredClone(category), fieldVersions: {} })
  }

  apply(operation: VersionedRetailOperation): "applied" | "duplicate" {
    if (this.applied.has(operation.operationId)) return "duplicate"
    this.applied.add(operation.operationId)
    const version = operation.version
    if (operation.kind === "product.patch") {
      const record = this.products.get(operation.productId)
      if (record && !record.tombstone)
        for (const [field, value] of Object.entries(operation.changes) as Array<[keyof VersionedProductField, VersionedProductField[keyof VersionedProductField]]>) {
          const previous = record.fieldVersions[field]
          if (!previous || compareRetailVersions(version, previous) > 0) {
            record.fields = { ...record.fields, [field]: value }
            record.fieldVersions[field] = version
          }
        }
    } else if (operation.kind === "product.delete") {
      const record = this.products.get(operation.productId)
      if (record && (!record.tombstone || compareRetailVersions(version, record.tombstone) > 0) && (!record.restoredVersion || compareRetailVersions(version, record.restoredVersion) > 0)) record.tombstone = version
    } else if (operation.kind === "product.restore") {
      const record = this.products.get(operation.product.id)
      if (!record || !record.tombstone || compareRetailVersions(version, record.tombstone) > 0) this.products.set(operation.product.id, { fields: structuredClone(operation.product), fieldVersions: {}, restoredVersion: version })
    } else if (operation.kind === "category.patch") {
      const record = this.categories.get(operation.categoryId)
      if (record) for (const [field, value] of Object.entries(operation.changes) as Array<[keyof Category, string]>) {
        const previous = record.fieldVersions[field]
        if (!previous || compareRetailVersions(version, previous) > 0) {
          record.fields = { ...record.fields, [field]: value }
          record.fieldVersions[field] = version
        }
      }
    } else {
      this.inventory.set(operation.productId, (this.inventory.get(operation.productId) ?? 0) + operation.delta)
    }
    return "applied"
  }

  catalog(): { products: Product[]; categories: Category[] } {
    return {
      products: [...this.products.values()].filter((record) => !record.tombstone).map((record) => structuredClone(record.fields)),
      categories: [...this.categories.values()].map((record) => structuredClone(record.fields)),
    }
  }

  operationIds(): string[] { return [...this.applied].sort() }
}
