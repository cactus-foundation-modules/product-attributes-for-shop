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

  async applyImportedRow(productId: string, childProductId: string, row: Record<string, string>) {
    const cols = await columnsFor(productId)
    if (cols.length === 0) return
    // Match headers to attribute names case-insensitively; only columns the sheet
    // actually carries are touched, so a partial sheet leaves the rest alone.
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue
      const cellValue = (rowByLower.get(key) ?? '').trim()
      const valueId = cellValue ? await ensureAttributeValueByLabel(col.attributeId, cellValue) : null
      await setVariantAttributeValue(childProductId, col.attributeId, valueId)
    }
  },

  Cell: ProductAttributesVariantCell,
}
