import {
  listVariationColumns,
  getVariantAttributeValues,
  setVariantAttributeValue,
  ensureAttributeValueByLabel,
} from '@/modules/product-attributes-for-shop/lib/db/membership'
import { ProductAttributesVariantCell } from '@/modules/product-attributes-for-shop/components/admin/ProductAttributesVariantCell'
import type { PatVariationColumn } from '@/modules/product-attributes-for-shop/lib/types'

// Contributes one Variations-tab column per attribute this product uses for its
// variations, through shop-variations' `variant-field-provider` point. The same
// object drives the admin grid, the CSV export and the CSV import - and because
// the columns round-trip through shop-variations' CSV, the Google Sheet sync
// carries them without knowing they exist.
//
// shop-variations is an optional companion. When it is absent nothing calls this
// (the point has no host), and the queries below simply return no columns for a
// product with no variation attributes, so it is inert either way.

// listVariationColumns is the same for every row of a product, and the CSV import
// asks per variant, so a short cache spares a query per row during an import.
const CACHE_TTL_MS = 10_000
const columnCache = new Map<string, { cols: PatVariationColumn[]; at: number }>()

async function columnsFor(productId: string): Promise<PatVariationColumn[]> {
  const hit = columnCache.get(productId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cols
  const cols = await listVariationColumns(productId)
  columnCache.set(productId, { cols, at: Date.now() })
  return cols
}

// The context beginImport hands to each applyImportedRow of one parent's import:
// every child's current variation-attribute value, preloaded once, plus a cache
// of labels already resolved to value ids during this import. `current` is keyed
// child id -> attribute id -> resolved value id (null = none). A child absent from
// the map is a variant created mid-import: its current state is empty, so every
// non-empty cell writes.
type AttrImportCtx = {
  current: Map<string, Map<string, string | null>>
  labelCache: Map<string, string | null>
}

function isAttrImportCtx(ctx: unknown): ctx is AttrImportCtx {
  return !!ctx && typeof ctx === 'object' && 'current' in ctx && 'labelCache' in ctx
}

// The current value id for a (child, attribute), from the preloaded context. A
// context miss - no context at all, or a child not in the snapshot - resolves to
// null so a new variant is treated as having no value yet and gets written.
export function currentValueId(ctx: unknown, childProductId: string, attributeId: string): string | null {
  if (!isAttrImportCtx(ctx)) return null
  return ctx.current.get(childProductId)?.get(attributeId) ?? null
}

export const productAttributesVariantFieldProvider = {
  async listColumns(productId: string) {
    const cols = await listVariationColumns(productId)
    return cols.map((c) => ({ key: c.attributeId, label: c.name, order: c.position }))
  },

  async getValues(productId: string, childProductIds: string[]) {
    const byChild = await getVariantAttributeValues(productId, childProductIds)
    const out: Record<string, Record<string, string>> = {}
    for (const [childId, byAttr] of Object.entries(byChild)) {
      out[childId] = {}
      for (const [attributeId, v] of Object.entries(byAttr)) out[childId][attributeId] = v.label
    }
    return out
  },

  // Preload every child's current variation-attribute value for this parent in one
  // query, so applyImportedRow diffs in memory instead of writing blind per row.
  async beginImport(productId: string, childProductIds: string[]): Promise<AttrImportCtx> {
    const byChild = await getVariantAttributeValues(productId, childProductIds)
    const current = new Map<string, Map<string, string | null>>()
    for (const [childId, byAttr] of Object.entries(byChild)) {
      const attrMap = new Map<string, string | null>()
      for (const [attributeId, v] of Object.entries(byAttr)) attrMap.set(attributeId, v.valueId)
      current.set(childId, attrMap)
    }
    return { current, labelCache: new Map() }
  },

  async applyImportedRow(productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    const cols = await columnsFor(productId)
    if (cols.length === 0) return
    const importCtx = isAttrImportCtx(ctx) ? ctx : undefined
    // Match headers to attribute names case-insensitively; only columns the sheet
    // actually carries are touched, so a partial sheet leaves the rest alone.
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue
      const cellValue = (rowByLower.get(key) ?? '').trim()
      // Resolve the wanted value id, caching each label lookup within this import so
      // the same label across many rows is only ensured once.
      let valueId: string | null = null
      if (cellValue) {
        const cacheKey = `${col.attributeId}|${cellValue.toLowerCase()}`
        if (importCtx?.labelCache.has(cacheKey)) {
          valueId = importCtx.labelCache.get(cacheKey) ?? null
        } else {
          valueId = await ensureAttributeValueByLabel(col.attributeId, cellValue)
          importCtx?.labelCache.set(cacheKey, valueId)
        }
      }
      // Only write when the resolved value actually differs from what is stored -
      // the change detection the blind per-row write used to skip. A context miss
      // (new variant) reads as null, so its first non-empty value still writes.
      if (valueId === currentValueId(importCtx, childProductId, col.attributeId)) continue
      await setVariantAttributeValue(childProductId, col.attributeId, valueId)
      // Keep the context current so a later row for the same child (a duplicated
      // combination) sees this write and does not repeat it.
      if (importCtx) {
        const attrMap = importCtx.current.get(childProductId) ?? new Map<string, string | null>()
        attrMap.set(col.attributeId, valueId)
        importCtx.current.set(childProductId, attrMap)
      }
    }
  },

  Cell: ProductAttributesVariantCell,
}
