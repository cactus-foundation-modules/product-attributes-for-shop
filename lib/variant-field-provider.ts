import {
  listVariationColumns,
  listVariationColumnsForProducts,
  getVariantAttributeValues,
  getVariantAttributeValuesForProducts,
  setVariantAttributeValue,
  ensureAttributeValueByLabel,
  findAttributeValueByLabel,
  listAllAttributes,
  listVariationAttachBlocks,
  listAutoAttachDeclines,
  upsertVariationAttribute,
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

// This product's columns, from a batched preload where the caller made one, else
// the short per-product cache. A product missing from a preloaded map genuinely
// has no variation columns - the batch covered every parent it was given - so an
// empty list is the answer, not a reason to go and ask again.
async function columnsForWithCtx(productId: string, ctx?: AttrImportCtx): Promise<PatVariationColumn[]> {
  if (ctx?.columns) return ctx.columns.get(productId) ?? []
  return columnsFor(productId)
}

async function columnsFor(productId: string): Promise<PatVariationColumn[]> {
  const hit = columnCache.get(productId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cols
  const cols = await listVariationColumns(productId)
  columnCache.set(productId, { cols, at: Date.now() })
  return cols
}

// A column heading naming an attribute the product does not use yet ATTACHES that
// attribute to the product as a variation column and sets each variant's value -
// so an attribute can be put on a product straight from the sheet, with no
// ceremony beyond typing its name at the top of a column.
//
// This is the third go at it, and the two ways it went wrong before are each shut
// off by their own mechanism rather than by making the owner ask twice:
//
//   1. IT USED TO RE-ASSERT ITSELF. An attached column goes straight back into the
//      sheet on the next Push, so removing it on the product's Attributes tab
//      lasted until the next Pull put it back - a column that could not be
//      deleted. Now the removal is REMEMBERED: `setProductAttributes` records the
//      (product, attribute) pair in `pat_variation_attach_blocks`, and
//      `upsertVariationAttribute` refuses a blocked pair in the INSERT itself. The
//      sheet proposes, the owner disposes, and putting the attribute back by hand
//      clears the block. See migrations/011.
//
//   2. IT USED TO HIJACK A PRODUCT-LEVEL HELPING. `upsertProductAttribute` flipped
//      an existing helping to use-for-variations, which is how a live catalogue
//      ended up with spec fields standing as per-variant columns on twenty-odd
//      products. `upsertVariationAttribute` creates its own helping or declines;
//      it never flips one.
//
// What is left is genuinely reversible, which is the whole difference: an attach
// nobody wanted is one deletion away from being gone for good.
//
// A trailing star on the heading ("Shipping *") is tolerated and ignored - an
// earlier version of this asked for one, and a sheet still carrying them should
// not quietly stop working. The Google-Sheet mirror clears it on the next Push.
const TOLERATED_MARKER = /\s*\*\s*$/

// The attribute name a heading names, with any tolerated marker taken off.
function attachHeaderName(header: string): string {
  return header.trim().replace(TOLERATED_MARKER, '').trim()
}

// Headings on the Variations tab that belong to shop-variations or another module,
// never to an attribute. A heading matching one of these is refused, so an
// attribute the owner happens to have named "Supplier" can never hijack the real
// Supplier column. Option/Value pairs are matched by pattern, not listed.
const RESERVED_VARIATION_HEADERS: ReadonlySet<string> = new Set([
  'parent slug', 'parent name', 'variant sku', 'sale sku', 'price', 'sale price', 'rrp', 'trade price', 'cost price',
  'stock', 'barcode', 'supplier', 'weight', 'image', 'variant id',
])
const OPTION_PAIR_HEADER = /^(option|value) \d+$/

// The whole attribute vocabulary keyed by lower-cased name, cached like the
// columns above. Lets an import match a marked heading to the attribute it names
// even when the product does not use that attribute yet.
const attrNameCache = { map: null as Map<string, { id: string; name: string }> | null, at: 0 }
async function attributesByName(): Promise<Map<string, { id: string; name: string }>> {
  if (attrNameCache.map && Date.now() - attrNameCache.at < CACHE_TTL_MS) return attrNameCache.map
  const all = await listAllAttributes()
  const map = new Map(all.map((a) => [a.name.trim().toLowerCase(), { id: a.id, name: a.name }]))
  attrNameCache.map = map
  attrNameCache.at = Date.now()
  return map
}

// The context beginImport hands to each applyImportedRow of one parent's import:
// every child's current variation-attribute value, preloaded once, plus a cache
// of labels already resolved to value ids during this import. `current` is keyed
// child id -> assignment id -> resolved value id (null = none). A child absent from
// the map is a variant created mid-import: its current state is empty, so every
// non-empty cell writes.
type AttrImportCtx = {
  current: Map<string, Map<string, string | null>>
  // Every parent's variation columns, preloaded when the context covers many
  // parents. Absent on a single-parent context, where columnsFor's own short
  // cache is enough and one lookup is not worth a query for the whole catalogue.
  columns?: Map<string, PatVariationColumn[]>
  labelCache: Map<string, string | null>
  // Labels the READ-ONLY twin looked up and did not find. It must never put those
  // misses in `labelCache`: the write path reads that same cache, and a cached
  // "not found" told applyCellValue there was no value to store - so a label the
  // sheet had introduced was never created, the cell never written, and the next
  // Pull offered the very same row up again. On a live catalogue that was 13,691
  // variations "to update" on every Pull, for ever. Positive hits are still
  // shared (an id found is the id an ensure would return); only the misses are
  // kept apart.
  missCache: Set<string>
  // "productId|attributeId" for every pair whose auto-attach would DECLINE -
  // the un-named slot is held by a product-level helping, which is never
  // flipped. Preloaded so the read-only twin can decline in step with the write
  // path instead of reporting a change that never happens.
  declines: Set<string>
  // Attributes attached during this import, "productId|attributeId" -> the
  // assignment id it got, so a marked column is upserted once rather than once per
  // row that carries it. Keyed by PRODUCT and attribute, not attribute alone: one
  // context now covers many parents (see beginImportMany), and an attribute-only
  // key would hand parent B the helping that was created for parent A.
  attached: Map<string, string>
  // "productId|attributeId" for every pair the owner has taken off by hand,
  // preloaded so the read-only twin can decline them without a query per row.
  // The WRITE path does not lean on this - `upsertVariationAttribute` re-checks
  // in SQL, which is what makes a product created mid-import safe.
  blocks: Set<string>
}

function isAttrImportCtx(ctx: unknown): ctx is AttrImportCtx {
  return !!ctx && typeof ctx === 'object' && 'current' in ctx && 'labelCache' in ctx && 'attached' in ctx
    && 'blocks' in ctx && 'missCache' in ctx && 'declines' in ctx
}

// The current value id for a (child, helping), from the preloaded context. A
// context miss - no context at all, or a child not in the snapshot - resolves to
// null so a new variant is treated as having no value yet and gets written.
export function currentValueId(ctx: unknown, childProductId: string, assignmentId: string): string | null {
  if (!isAttrImportCtx(ctx)) return null
  return ctx.current.get(childProductId)?.get(assignmentId) ?? null
}

// Resolve a cell's label to a value id and store it against one helping, unless
// that is already what is stored. Shared by the two halves of applyImportedRow -
// the columns the product has, and the ones a marked heading has just added -
// which write identically once they know their assignment.
//
// The label is resolved against the ATTRIBUTE: two helpings of one attribute draw
// on the same vocabulary, so "Oak" typed under the edge column is the same value
// the main column offers, and the cache is keyed to match. Where it is stored is
// the helping's business.
async function applyCellValue(
  attributeId: string,
  assignmentId: string,
  cellValue: string,
  childProductId: string,
  importCtx: AttrImportCtx | undefined,
): Promise<void> {
  let valueId: string | null = null
  if (cellValue) {
    const cacheKey = `${attributeId}|${cellValue.toLowerCase()}`
    if (importCtx?.labelCache.has(cacheKey)) {
      valueId = importCtx.labelCache.get(cacheKey) ?? null
    } else {
      valueId = await ensureAttributeValueByLabel(attributeId, cellValue)
      importCtx?.labelCache.set(cacheKey, valueId)
    }
  }
  // Only write when the resolved value actually differs from what is stored - the
  // change detection the blind per-row write used to skip. A context miss (a new
  // variant) reads as null, so its first non-empty value still writes.
  if (valueId === currentValueId(importCtx, childProductId, assignmentId)) return
  await setVariantAttributeValue(childProductId, assignmentId, valueId)
  // Keep the context current so a later row for the same child (a duplicated
  // combination) sees this write and does not repeat it.
  if (importCtx) {
    const byAssignment = importCtx.current.get(childProductId) ?? new Map<string, string | null>()
    byAssignment.set(assignmentId, valueId)
    importCtx.current.set(childProductId, byAssignment)
  }
}

// Read-only twin of applyCellValue: would writing this cell change anything?
// Resolves the label without creating it, and compares to what is stored.
//
// `assignmentId` is null for a marked heading whose attribute the product does not
// carry yet - there is no helping to compare against, so any non-empty value is a
// change (applying the row would attach the attribute and set it).
async function cellChanged(
  attributeId: string,
  assignmentId: string | null,
  cellValue: string,
  childProductId: string,
  importCtx: AttrImportCtx | undefined,
): Promise<boolean> {
  const stored = assignmentId ? currentValueId(importCtx, childProductId, assignmentId) : null
  // Emptying a cell that currently holds a value is a change (it clears it).
  if (!cellValue) return stored !== null
  if (!assignmentId) return true
  // Resolve the wanted id read-only. A label already in the vocabulary maps to its
  // id; an unknown label maps to null here, but applying the row would create it -
  // either way, a mismatch with the stored id is a change.
  //
  // The result goes back into the cache, exactly as applyCellValue does with its
  // own lookups. Reading the cache without ever filling it meant a catalogue
  // repeating "Oak" down 577 rows asked the database 577 times, once per row per
  // column, and a preview of a few hundred variants spent the whole of its
  // sixty-second budget on round trips it had already made.
  //
  // The two halves DO share a context: shop-variations' importer asks rowChanged
  // and then applyImportedRow with the same one. A found id is the same answer
  // either half would give, so it is shared; a MISS is not, because the write
  // path would go on to create the value - so misses live in `missCache`, which
  // only this half reads.
  const cacheKey = `${attributeId}|${cellValue.toLowerCase()}`
  let valueId: string | null | undefined = importCtx?.labelCache.get(cacheKey)
  if (valueId === undefined && importCtx?.missCache.has(cacheKey)) valueId = null
  if (valueId === undefined) {
    valueId = await findAttributeValueByLabel(attributeId, cellValue)
    // A hit is the id an ensure would hand back too, so the write path may share
    // it. A MISS is only true of this read-only lookup - the write path would
    // create the value - so it is kept in its own set. See `missCache`.
    if (valueId === null) importCtx?.missCache.add(cacheKey)
    else importCtx?.labelCache.set(cacheKey, valueId)
  }
  // A non-empty label the vocabulary has not seen yet resolves to null here, but
  // applyImportedRow WILL create it and assign it - a brand-new value id that can
  // equal nothing already stored, so it is always a change. Reducing this to
  // `valueId !== stored` missed the one case where both are null: a fresh attribute
  // whose cells were all empty, the owner typing its first values in the sheet.
  // null === null read as "nothing to do", so the Google-Sheet Pull dropped every
  // one of those rows and the new catalogue names never imported - the very thing a
  // rowChanged twin exists to prevent.
  return valueId === null || valueId !== stored
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
    const [byChild, blocks, declines] = await Promise.all([
      getVariantAttributeValues(productId, childProductIds),
      listVariationAttachBlocks([productId]),
      listAutoAttachDeclines([productId], true),
    ])
    const current = new Map<string, Map<string, string | null>>()
    for (const [childId, byAssignment] of Object.entries(byChild)) {
      const assignmentMap = new Map<string, string | null>()
      for (const [assignmentId, v] of Object.entries(byAssignment)) assignmentMap.set(assignmentId, v.valueId)
      current.set(childId, assignmentMap)
    }
    return { current, labelCache: new Map(), missCache: new Set(), attached: new Map(), blocks, declines }
  },

  // The batched preload: one context covering many parents, so a catalogue-wide
  // caller pays two queries instead of two per parent. Everything it holds is
  // keyed by child product id or parent id, both globally unique, which is what
  // makes one shared context safe across every parent in the batch.
  async beginImportMany(parents: Array<{ productId: string; childProductIds: string[] }>): Promise<AttrImportCtx> {
    const productIds = parents.map((p) => p.productId)
    const childProductIds = parents.flatMap((p) => p.childProductIds)
    const [byChild, columns, blocks, declines] = await Promise.all([
      getVariantAttributeValuesForProducts(productIds, childProductIds),
      listVariationColumnsForProducts(productIds),
      listVariationAttachBlocks(productIds),
      listAutoAttachDeclines(productIds, true),
    ])
    const current = new Map<string, Map<string, string | null>>()
    for (const [childId, byAssignment] of Object.entries(byChild)) {
      const assignmentMap = new Map<string, string | null>()
      for (const [assignmentId, v] of Object.entries(byAssignment)) assignmentMap.set(assignmentId, v.valueId)
      current.set(childId, assignmentMap)
    }
    return { current, columns, labelCache: new Map(), missCache: new Set(), attached: new Map(), blocks, declines }
  },

  async applyImportedRow(productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    const importCtx = isAttrImportCtx(ctx) ? ctx : undefined
    // Deliberately NOT read from a batched preload. A preloaded map answers
    // "absent means no columns", which is true of the parents the batch covered
    // and false of a product created part-way through an import - and on the
    // write path that silence would drop a new product's attributes rather than
    // merely miscount them. The read path can afford the assumption; this cannot.
    const cols = await columnsFor(productId)
    // Match headers to attribute names case-insensitively; only columns the sheet
    // actually carries are touched, so a partial sheet leaves the rest alone.
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue
      await applyCellValue(col.attributeId, col.assignmentId, (rowByLower.get(key) ?? '').trim(), childProductId, importCtx)
    }

    // Attach. A heading naming an attribute this product does not use for
    // variations yet attaches that attribute to the product as a variation column
    // and sets the value. Only a heading naming an attribute that already exists
    // acts, and never off a blank cell: an unknown heading is somebody else's -
    // another module's field, or one of the owner's own - and is left as it is.
    const colsByName = new Map(cols.map((c) => [c.name.trim().toLowerCase(), c]))
    let attrByName: Map<string, { id: string; name: string }> | null = null
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const name = attachHeaderName(rawKey)
      if (!name) continue
      const key = name.toLowerCase()
      if (RESERVED_VARIATION_HEADERS.has(key) || OPTION_PAIR_HEADER.test(key)) continue
      // Already one of this product's columns - the loop above has just filled it.
      if (colsByName.has(key)) continue
      const cellValue = (rawVal ?? '').trim()
      if (!cellValue) continue
      attrByName ??= await attributesByName()
      const attr = attrByName.get(key)
      if (!attr) continue

      let assignmentId = importCtx?.attached.get(`${productId}|${attr.id}`)
      if (!assignmentId) {
        const made = await upsertVariationAttribute(productId, attr.id)
        // null means one of two refusals, both deliberate: the owner has taken
        // this attribute off this product by hand (so the heading does not get to
        // put it back), or the un-named helping for it is their product-level one
        // and is never hijacked. Either way the product is left alone.
        if (!made) continue
        assignmentId = made
        importCtx?.attached.set(`${productId}|${attr.id}`, assignmentId)
        // The product's column list has just changed under the short cache.
        columnCache.delete(productId)
      }
      await applyCellValue(attr.id, assignmentId, cellValue, childProductId, importCtx)
    }
  },

  // Read-only twin of applyImportedRow, for the import preview's change count.
  // Compares each cell to what is stored exactly as applyImportedRow does - but
  // writes nothing, creates no value for a new label, and attaches no attribute
  // for a marked heading. A preview must not mutate.
  async rowChanged(productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    const importCtx = isAttrImportCtx(ctx) ? ctx : undefined
    const cols = await columnsForWithCtx(productId, importCtx)
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue
      const cellValue = (rowByLower.get(key) ?? '').trim()
      if (await cellChanged(col.attributeId, col.assignmentId, cellValue, childProductId, importCtx)) return true
    }

    // Attach detection, read-only twin of the block in applyImportedRow. A
    // non-empty value under a heading naming an existing attribute the product
    // does not carry would attach it, so nothing is stored against it and it
    // counts as a change - UNLESS the owner has blocked that pair, in which case
    // applying the row would do nothing and neither does this. An unknown heading
    // changes nothing, so it can never make a row count as changed.
    const colsByName = new Map(cols.map((c) => [c.name.trim().toLowerCase(), c]))
    let attrByName: Map<string, { id: string; name: string }> | null = null
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const name = attachHeaderName(rawKey)
      if (!name) continue
      const key = name.toLowerCase()
      if (RESERVED_VARIATION_HEADERS.has(key) || OPTION_PAIR_HEADER.test(key)) continue
      if (colsByName.has(key)) continue // already compared by the loop above
      const cellValue = (rawVal ?? '').trim()
      if (!cellValue) continue
      attrByName ??= await attributesByName()
      const attr = attrByName.get(key)
      if (!attr) continue
      if (importCtx?.blocks.has(`${productId}|${attr.id}`)) continue
      // The un-named slot is a product-level helping, which upsertVariationAttribute
      // never flips - applying this row would leave the product alone, so neither
      // does this.
      if (importCtx?.declines.has(`${productId}|${attr.id}`)) continue
      if (await cellChanged(attr.id, null, cellValue, childProductId, importCtx)) return true
    }
    return false
  },

  Cell: ProductAttributesVariantCell,
}
