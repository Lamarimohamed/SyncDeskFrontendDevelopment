import type { Category, Product } from "../../domain/types"
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
}

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
    } else {
      const nextStock = (this.inventory.get(operation.productId) ?? this.products.get(operation.productId)?.fields.stock ?? 0) + operation.delta
      this.inventory.set(operation.productId, nextStock)
      const product = this.products.get(operation.productId)
      if (product && !product.tombstone) product.fields = { ...product.fields, stock: Math.max(0, nextStock) }
    }
    return "applied"
  }

  catalog(): { products: Product[]; categories: Category[] } {
    return {
      products: [...this.products.values()].filter((record) => !record.tombstone).map((record) => structuredClone(record.fields)),
      categories: [...this.categories.values()].filter((record) => !record.tombstone).map((record) => structuredClone(record.fields)),
    }
  }

  operationIds(): string[] { return [...this.applied].sort() }

  snapshot(): VersionedRetailRuntimeSnapshot {
    return structuredClone({
      products: [...this.products.entries()].sort(([left], [right]) => left.localeCompare(right)),
      categories: [...this.categories.entries()].sort(([left], [right]) => left.localeCompare(right)),
      inventory: [...this.inventory.entries()].sort(([left], [right]) => left.localeCompare(right)),
      appliedOperationIds: this.operationIds(),
    })
  }
}
