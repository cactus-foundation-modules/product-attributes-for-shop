import {
  listProductLevelColumns,
  listProductLevelColumnsForProducts,
  ensureAttributeValueByLabel,
  findAttributeValueByLabel,
  listAllAttributes,
  upsertProductLevelAttribute,
} from '@/modules/product-attributes-for-shop/lib/db/membership'
import {
  getProductOwnValuesByAssignment,
  getProductOwnValueIdsByAssignment,
  setProductAssignmentValues,
} from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { CSV_COLUMNS } from '@/modules/shop/lib/csv'

// Contributes one Products-tab column per product-level attribute a product uses,
// through shop's `product-field-provider` point. The product-level twin of this
// module's variant field provider: that one carries a variant's attribute values
// on the Variations tab, this one carries the parent product's own ticks on the
// Products tab. Because the columns round-trip through the sheet sync, the owner
// can read and set them from the spreadsheet.
//
// A product-level helping is multi-select, so a cell can hold several labels; they
// are written comma-separated, the same shape the variant Image column uses. An
// import splits on the comma, resolves each label against the attribute (creating
// one the vocabulary has not seen yet, exactly as a variation cell does), and
// replaces that one helping's ticks - never the product's other helpings.

type PatProductLevelColumn = { assignmentId: string; attributeId: string; name: string; position: number }

// listProductLevelColumns is the same for every row of a product and the import
// asks per product, so a short cache spares a query per product during a Pull.
const CACHE_TTL_MS = 10_000
const columnCache = new Map<string, { cols: PatProductLevelColumn[]; at: number }>()

// The preloaded columns for this product, or a query when there is no context to
// read them from (a caller with no beginImport, e.g. the sheet's Push building
// its header). A product absent from a preloaded map genuinely has no columns -
// the batch covered every id it was given - so an empty list is the right answer
// rather than a reason to go and ask again.
async function columnsForWithCtx(productId: string, ctx?: ProdImportCtx): Promise<PatProductLevelColumn[]> {
  // `ctx.columns` is only absent on a context built before this preload existed;
  // the type guard cannot see the difference, so fall back rather than throw.
  if (ctx?.columns) return ctx.columns.get(productId) ?? []
  return columnsFor(productId)
}

async function columnsFor(productId: string): Promise<PatProductLevelColumn[]> {
  const hit = columnCache.get(productId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cols
  const cols = await listProductLevelColumns(productId)
  columnCache.set(productId, { cols, at: Date.now() })
  return cols
}

// The whole attribute vocabulary keyed by lower-cased name, cached like the
// columns above. Lets an import match a Products-tab column heading to the
// attribute it names even when the product does not use that attribute at product
// level yet, so a value typed there can auto-attach the attribute. The product
// twin of the variant field provider's own attributesByName.
const attrNameCache = { map: null as Map<string, { id: string; name: string }> | null, at: 0 }
async function attributesByName(): Promise<Map<string, { id: string; name: string }>> {
  if (attrNameCache.map && Date.now() - attrNameCache.at < CACHE_TTL_MS) return attrNameCache.map
  const all = await listAllAttributes()
  const map = new Map(all.map((a) => [a.name.trim().toLowerCase(), { id: a.id, name: a.name }]))
  attrNameCache.map = map
  attrNameCache.at = Date.now()
  return map
}

// Products-tab headings that belong to shop's own fixed CSV columns, never to an
// attribute. An auto-attach match against one of these is refused, so an attribute
// the owner happens to have named "Supplier" can never hijack the real supplier
// column. CSV_COLUMNS are already lower-case snake_case, the same shape the keys
// below are compared in.
const RESERVED_PRODUCT_HEADERS: ReadonlySet<string> = new Set(CSV_COLUMNS)

// Is this heading eligible to auto-attach an attribute? It must not already be one
// of the product's product-level columns, nor a fixed product column.
function isAutoAttachHeader(key: string, assignedNames: ReadonlySet<string>): boolean {
  return !assignedNames.has(key) && !RESERVED_PRODUCT_HEADERS.has(key)
}

const VALUE_SEPARATOR = ', '
function serialiseLabels(labels: string[]): string {
  return labels.join(VALUE_SEPARATOR)
}
function parseLabels(cell: string): string[] {
  return cell.split(',').map((s) => s.trim()).filter(Boolean)
}
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

// The context beginImport hands to each applyImportedRow: every product's current
// product-level ticks (as value id sets) preloaded once, plus a cache of labels
// already resolved to value ids during this import. A product absent from the map
// (created mid-import) reads as having no ticks yet, so its first values write.
type ProdImportCtx = {
  current: Map<string, Map<string, Set<string>>>
  // Every product's columns, preloaded in one query. Asking per product is a
  // round trip per product, which on a catalogue-wide pass is the whole cost of
  // the pass - see listProductLevelColumnsForProducts.
  columns: Map<string, PatProductLevelColumn[]>
  labelCache: Map<string, string | null>
  // Attributes auto-attached at product level during this import, attribute id ->
  // the assignment id it got. Keeps the upsert to once per attribute per product
  // rather than once per row - a product is a single row on the Products tab, so
  // this is keyed product id -> attribute id -> assignment id.
  assigned: Map<string, Map<string, string>>
}

function isProdImportCtx(ctx: unknown): ctx is ProdImportCtx {
  return !!ctx && typeof ctx === 'object' && 'current' in ctx && 'labelCache' in ctx && 'assigned' in ctx
}

function currentValueIds(ctx: unknown, productId: string, assignmentId: string): Set<string> {
  if (!isProdImportCtx(ctx)) return new Set()
  return ctx.current.get(productId)?.get(assignmentId) ?? new Set()
}

export const productAttributesProductFieldProvider = {
  async listColumns(productId: string) {
    const cols = await columnsFor(productId)
    return cols.map((c) => ({ key: c.assignmentId, label: c.name, order: c.position }))
  },

  async getValues(productIds: string[]) {
    const byProduct = await getProductOwnValuesByAssignment(productIds)
    const out: Record<string, Record<string, string>> = {}
    for (const [productId, byAssignment] of Object.entries(byProduct)) {
      out[productId] = {}
      for (const [assignmentId, labels] of Object.entries(byAssignment)) out[productId][assignmentId] = serialiseLabels(labels)
    }
    return out
  },

  // Preload every product's current product-level ticks in one query.
  async beginImport(productIds: string[]): Promise<ProdImportCtx> {
    const [byProduct, columns] = await Promise.all([
      getProductOwnValueIdsByAssignment(productIds),
      listProductLevelColumnsForProducts(productIds),
    ])
    const current = new Map<string, Map<string, Set<string>>>()
    for (const [productId, byAssignment] of Object.entries(byProduct)) {
      const assignmentMap = new Map<string, Set<string>>()
      for (const [assignmentId, valueIds] of Object.entries(byAssignment)) assignmentMap.set(assignmentId, new Set(valueIds))
      current.set(productId, assignmentMap)
    }
    return { current, columns, labelCache: new Map(), assigned: new Map() }
  },

  async applyImportedRow(productId: string, row: Record<string, string>, ctx?: unknown): Promise<boolean> {
    const cols = await columnsFor(productId)
    const importCtx = isProdImportCtx(ctx) ? ctx : undefined
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    let changed = false

    // Resolves a cell's comma-separated labels to the value ids to tick, ensuring
    // (creating) each label the attribute has not seen yet, caching each lookup so
    // the same label across products is only ensured once.
    const resolveWanted = async (attributeId: string, cell: string): Promise<Set<string>> => {
      const wanted = new Set<string>()
      for (const label of parseLabels(cell)) {
        const cacheKey = `${attributeId}|${label.toLowerCase()}`
        let valueId: string | null
        if (importCtx?.labelCache.has(cacheKey)) {
          valueId = importCtx.labelCache.get(cacheKey) ?? null
        } else {
          valueId = await ensureAttributeValueByLabel(attributeId, label)
          importCtx?.labelCache.set(cacheKey, valueId)
        }
        if (valueId) wanted.add(valueId)
      }
      return wanted
    }
    // Writes one helping's ticks when they differ from what is stored, keeping the
    // context current so nothing writes twice.
    const applyAssignment = async (attributeId: string, assignmentId: string, cell: string): Promise<void> => {
      const wanted = await resolveWanted(attributeId, cell)
      if (sameSet(currentValueIds(importCtx, productId, assignmentId), wanted)) return
      await setProductAssignmentValues(productId, assignmentId, [...wanted])
      changed = true
      if (importCtx) {
        const byAssignment = importCtx.current.get(productId) ?? new Map<string, Set<string>>()
        byAssignment.set(assignmentId, wanted)
        importCtx.current.set(productId, byAssignment)
      }
    }

    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue // column not in the sheet - leave this helping alone
      await applyAssignment(col.attributeId, col.assignmentId, rowByLower.get(key) ?? '')
    }

    // Auto-attach. A value typed into a Products-tab column that names an existing
    // attribute this product does not use at product level yet attaches that
    // attribute (as a product-level helping) and ticks the value(s) - so an
    // existing attribute can be put onto any product straight from the sheet, the
    // same way the Variations tab does for variation attributes. Only a heading
    // matching an EXISTING attribute acts; an unknown heading is the owner's own
    // column and is left alone, a fixed product column can never be hijacked, and
    // a blank cell never creates an assignment.
    const assignedNames = new Set(cols.map((c) => c.name.trim().toLowerCase()))
    const attrByName = await attributesByName()
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = rawKey.trim().toLowerCase()
      if (!isAutoAttachHeader(key, assignedNames)) continue
      const cell = rawVal ?? ''
      if (parseLabels(cell).length === 0) continue
      const attr = attrByName.get(key)
      if (!attr) continue
      // Get-or-make the product-level assignment, once per attribute per product.
      // Returns null when the only helping for the attribute is a variation one -
      // that slot is never flipped, so the product is left alone.
      let assignmentId = importCtx?.assigned.get(productId)?.get(attr.id)
      if (!assignmentId) {
        const made = await upsertProductLevelAttribute(productId, attr.id)
        if (!made) continue
        assignmentId = made
        if (importCtx) {
          const byAttr = importCtx.assigned.get(productId) ?? new Map<string, string>()
          byAttr.set(attr.id, assignmentId)
          importCtx.assigned.set(productId, byAttr)
        }
      }
      await applyAssignment(attr.id, assignmentId, cell)
    }

    return changed
  },

  // Read-only twin of applyImportedRow for the Pull's diff. Resolves each cell's
  // wanted ids without creating any, and compares to what is stored. A non-empty
  // label the vocabulary has not seen yet has no id here but apply would create and
  // tick it, so it always counts as a change.
  async rowChanged(productId: string, row: Record<string, string>, ctx?: unknown): Promise<boolean> {
    const importCtx = isProdImportCtx(ctx) ? ctx : undefined
    const cols = await columnsForWithCtx(productId, importCtx)
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue
      const wanted = new Set<string>()
      for (const label of parseLabels(rowByLower.get(key) ?? '')) {
        const cacheKey = `${col.attributeId}|${label.toLowerCase()}`
        let valueId: string | null | undefined = importCtx?.labelCache.get(cacheKey)
        if (valueId === undefined) {
          valueId = await findAttributeValueByLabel(col.attributeId, label)
          importCtx?.labelCache.set(cacheKey, valueId)
        }
        if (valueId === null) return true // apply would create and tick a new value
        wanted.add(valueId)
      }
      if (!sameSet(currentValueIds(importCtx, productId, col.assignmentId), wanted)) return true
    }

    // Auto-attach detection, read-only twin of the block in applyImportedRow. A
    // non-empty value in a Products-tab column that names an existing attribute
    // this product does not use at product level yet would attach it and tick the
    // value on apply - nothing is stored against it, so it counts as a change.
    // Creates nothing. (May over-report the rare case where only a variation
    // helping exists and apply would decline: the row then goes through as a
    // no-op, slower but never wrong.)
    const assignedNames = new Set(cols.map((c) => c.name.trim().toLowerCase()))
    const attrByName = await attributesByName()
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = rawKey.trim().toLowerCase()
      if (!isAutoAttachHeader(key, assignedNames)) continue
      if (parseLabels(rawVal ?? '').length === 0) continue
      if (attrByName.has(key)) return true
    }
    return false
  },
}
