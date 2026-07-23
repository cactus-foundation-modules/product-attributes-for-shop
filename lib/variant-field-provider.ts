import {
  listVariationColumns,
  getVariantAttributeValues,
  setVariantAttributeValue,
  ensureAttributeValueByLabel,
  findAttributeValueByLabel,
  listAllAttributes,
  upsertProductAttribute,
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

// The whole attribute vocabulary keyed by lower-cased name, cached like the
// columns above. Lets an import match a sheet column heading to the attribute it
// names even when the product does not use that attribute yet, so a value typed
// there can auto-attach the attribute to the product.
const attrNameCache = { map: null as Map<string, { id: string; name: string }> | null, at: 0 }
async function attributesByName(): Promise<Map<string, { id: string; name: string }>> {
  if (attrNameCache.map && Date.now() - attrNameCache.at < CACHE_TTL_MS) return attrNameCache.map
  const all = await listAllAttributes()
  const map = new Map(all.map((a) => [a.name.trim().toLowerCase(), { id: a.id, name: a.name }]))
  attrNameCache.map = map
  attrNameCache.at = Date.now()
  return map
}

// Headings on the Variations tab that belong to shop-variations or another module,
// never to an attribute. An auto-assign match against one of these is refused, so
// an attribute the owner happens to have named "Supplier" can never hijack the
// real Supplier column. Option/Value pairs are matched by pattern, not listed.
const RESERVED_VARIATION_HEADERS: ReadonlySet<string> = new Set([
  'parent slug', 'parent name', 'variant sku', 'price', 'sale price', 'rrp', 'trade price', 'cost price',
  'stock', 'barcode', 'supplier', 'weight', 'image', 'variant id',
])
const OPTION_PAIR_HEADER = /^(option|value) \d+$/

// Is this heading eligible to auto-attach an attribute? It must not already be one
// of the product's columns, nor a reserved/option heading.
function isAutoAssignHeader(key: string, assignedNames: ReadonlySet<string>): boolean {
  return !assignedNames.has(key) && !RESERVED_VARIATION_HEADERS.has(key) && !OPTION_PAIR_HEADER.test(key)
}

// The context beginImport hands to each applyImportedRow of one parent's import:
// every child's current variation-attribute value, preloaded once, plus a cache
// of labels already resolved to value ids during this import. `current` is keyed
// child id -> assignment id -> resolved value id (null = none). A child absent from
// the map is a variant created mid-import: its current state is empty, so every
// non-empty cell writes.
type AttrImportCtx = {
  current: Map<string, Map<string, string | null>>
  labelCache: Map<string, string | null>
  // Attributes auto-attached to this parent during the import, attribute id ->
  // the assignment id it got. Keeps the upsert to once per attribute rather than
  // once per row that carries its column.
  assigned: Map<string, string>
}

function isAttrImportCtx(ctx: unknown): ctx is AttrImportCtx {
  return !!ctx && typeof ctx === 'object' && 'current' in ctx && 'labelCache' in ctx && 'assigned' in ctx
}

// The current value id for a (child, helping), from the preloaded context. A
// context miss - no context at all, or a child not in the snapshot - resolves to
// null so a new variant is treated as having no value yet and gets written.
export function currentValueId(ctx: unknown, childProductId: string, assignmentId: string): string | null {
  if (!isAttrImportCtx(ctx)) return null
  return ctx.current.get(childProductId)?.get(assignmentId) ?? null
}

export const productAttributesVariantFieldProvider = {
  // The column key is the assignment, not the attribute: a product using Finish
  // for both its main and edge surfaces contributes two columns off one
  // attribute, and only the assignment tells them apart.
  async listColumns(productId: string) {
    const cols = await listVariationColumns(productId)
    return cols.map((c) => ({ key: c.assignmentId, label: c.name, order: c.position }))
  },

  async getValues(productId: string, childProductIds: string[]) {
    const byChild = await getVariantAttributeValues(productId, childProductIds)
    const out: Record<string, Record<string, string>> = {}
    for (const [childId, byAssignment] of Object.entries(byChild)) {
      out[childId] = {}
      for (const [assignmentId, v] of Object.entries(byAssignment)) out[childId][assignmentId] = v.label
    }
    return out
  },

  // Preload every child's current variation-attribute value for this parent in one
  // query, so applyImportedRow diffs in memory instead of writing blind per row.
  async beginImport(productId: string, childProductIds: string[]): Promise<AttrImportCtx> {
    const byChild = await getVariantAttributeValues(productId, childProductIds)
    const current = new Map<string, Map<string, string | null>>()
    for (const [childId, byAssignment] of Object.entries(byChild)) {
      const assignmentMap = new Map<string, string | null>()
      for (const [assignmentId, v] of Object.entries(byAssignment)) assignmentMap.set(assignmentId, v.valueId)
      current.set(childId, assignmentMap)
    }
    return { current, labelCache: new Map(), assigned: new Map() }
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
      // The label is resolved against the ATTRIBUTE - two helpings of one
      // attribute draw on the same vocabulary, so "Oak" typed under the edge
      // column is the same value the main column offers, and the cache is keyed
      // to match. Where it is stored, though, is the helping's business.
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
      if (valueId === currentValueId(importCtx, childProductId, col.assignmentId)) continue
      await setVariantAttributeValue(childProductId, col.assignmentId, valueId)
      // Keep the context current so a later row for the same child (a duplicated
      // combination) sees this write and does not repeat it.
      if (importCtx) {
        const byAssignment = importCtx.current.get(childProductId) ?? new Map<string, string | null>()
        byAssignment.set(col.assignmentId, valueId)
        importCtx.current.set(childProductId, byAssignment)
      }
    }

    // Auto-assign. A value typed into a column that names an attribute this
    // product does not yet use for variations attaches that attribute to the
    // product (as a variation column) and sets the value - so an existing
    // attribute can be put onto any product straight from the sheet. Only headings
    // that match an EXISTING attribute act; an unknown heading is the owner's own
    // column and is left alone, and a blank cell never creates an assignment.
    const assignedNames = new Set(cols.map((c) => c.name.trim().toLowerCase()))
    const attrByName = await attributesByName()
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = rawKey.trim().toLowerCase()
      if (!isAutoAssignHeader(key, assignedNames)) continue
      const cellValue = (rawVal ?? '').trim()
      if (!cellValue) continue
      const attr = attrByName.get(key)
      if (!attr) continue
      // Get-or-make the variation assignment, once per attribute in this import.
      // upsertProductAttribute matches the product's un-named helping for the
      // attribute (creating it use-for-variations when there is none), so a second
      // row carrying the same column reuses it rather than making a duplicate.
      let assignmentId = importCtx?.assigned.get(attr.id)
      if (!assignmentId) {
        const made = await upsertProductAttribute(productId, { attributeId: attr.id, useForVariations: true, showInFilters: false })
        if (!made) continue
        assignmentId = made
        importCtx?.assigned.set(attr.id, assignmentId)
      }
      const cacheKey = `${attr.id}|${cellValue.toLowerCase()}`
      let valueId: string | null
      if (importCtx?.labelCache.has(cacheKey)) {
        valueId = importCtx.labelCache.get(cacheKey) ?? null
      } else {
        valueId = await ensureAttributeValueByLabel(attr.id, cellValue)
        importCtx?.labelCache.set(cacheKey, valueId)
      }
      if (valueId === currentValueId(importCtx, childProductId, assignmentId)) continue
      await setVariantAttributeValue(childProductId, assignmentId, valueId)
      if (importCtx) {
        const byAssignment = importCtx.current.get(childProductId) ?? new Map<string, string | null>()
        byAssignment.set(assignmentId, valueId)
        importCtx.current.set(childProductId, byAssignment)
      }
    }
  },

  // Read-only twin of applyImportedRow, for the import preview's change count.
  // Resolves each cell's wanted value id and compares it to what is stored,
  // exactly as applyImportedRow does - but writes nothing, and crucially never
  // creates a value for a new label. A label the vocabulary has not seen yet has
  // no id, so it cannot equal the stored id, so it counts as a change (applying
  // the row would create it and assign it). That means the preview may resolve a
  // known label without materialising an unknown one, which is the point: a
  // preview must not mutate.
  async rowChanged(productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    const cols = await columnsFor(productId)
    if (cols.length === 0) return false
    const importCtx = isAttrImportCtx(ctx) ? ctx : undefined
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue
      const cellValue = (rowByLower.get(key) ?? '').trim()
      const stored = currentValueId(importCtx, childProductId, col.assignmentId)
      if (!cellValue) {
        // Emptying a cell that currently holds a value is a change (clears it).
        if (stored !== null) return true
        continue
      }
      // Resolve the wanted id read-only. A label already in the vocabulary maps
      // to its id; an unknown label maps to null here, but applying the row would
      // create it - either way, a mismatch with the stored id is a change.
      //
      // The result goes back into the cache, exactly as applyImportedRow does with
      // its own lookups. Reading the cache without ever filling it meant a catalogue
      // repeating "Oak" down 577 rows asked the database 577 times, once per row per
      // column, and a preview of a few hundred variants spent the whole of its
      // sixty-second budget on round trips it had already made. The two halves never
      // share a context (a preview and an import each begin their own), so the
      // find-only ids cached here can never stand in for the ensure that an import
      // would have done.
      const cacheKey = `${col.attributeId}|${cellValue.toLowerCase()}`
      let valueId: string | null | undefined = importCtx?.labelCache.get(cacheKey)
      if (valueId === undefined) {
        valueId = await findAttributeValueByLabel(col.attributeId, cellValue)
        importCtx?.labelCache.set(cacheKey, valueId)
      }
      // A non-empty label the vocabulary has not seen yet resolves to null here,
      // but applyImportedRow WILL create it and assign it - a brand-new value id
      // that can equal nothing already stored, so it is always a change. Reducing
      // it to `valueId !== stored` missed the one case where both are null: a
      // fresh attribute whose cells were all empty, the owner typing its first
      // values in the sheet. null === null read as "nothing to do", so the
      // Google-Sheet Pull dropped every one of those rows and the new catalogue
      // names never imported - the very thing a rowChanged twin exists to prevent.
      if (valueId === null || valueId !== stored) return true
    }

    // Auto-assign detection, read-only twin of the block in applyImportedRow. A
    // non-empty value in a column that names an existing attribute this product
    // does not use yet would attach the attribute and set the value on apply -
    // nothing is stored against it, so it is always a change. Creates nothing.
    const assignedNames = new Set(cols.map((c) => c.name.trim().toLowerCase()))
    const attrByName = await attributesByName()
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = rawKey.trim().toLowerCase()
      if (!isAutoAssignHeader(key, assignedNames)) continue
      if ((rawVal ?? '').trim() === '') continue
      if (attrByName.has(key)) return true
    }
    return false
  },

  Cell: ProductAttributesVariantCell,
}
