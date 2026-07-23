import {
  listProductLevelColumns,
  ensureAttributeValueByLabel,
  findAttributeValueByLabel,
} from '@/modules/product-attributes-for-shop/lib/db/membership'
import {
  getProductOwnValuesByAssignment,
  getProductOwnValueIdsByAssignment,
  setProductAssignmentValues,
} from '@/modules/product-attributes-for-shop/lib/db/assignments'

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

async function columnsFor(productId: string): Promise<PatProductLevelColumn[]> {
  const hit = columnCache.get(productId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cols
  const cols = await listProductLevelColumns(productId)
  columnCache.set(productId, { cols, at: Date.now() })
  return cols
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
  labelCache: Map<string, string | null>
}

function isProdImportCtx(ctx: unknown): ctx is ProdImportCtx {
  return !!ctx && typeof ctx === 'object' && 'current' in ctx && 'labelCache' in ctx
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
    const byProduct = await getProductOwnValueIdsByAssignment(productIds)
    const current = new Map<string, Map<string, Set<string>>>()
    for (const [productId, byAssignment] of Object.entries(byProduct)) {
      const assignmentMap = new Map<string, Set<string>>()
      for (const [assignmentId, valueIds] of Object.entries(byAssignment)) assignmentMap.set(assignmentId, new Set(valueIds))
      current.set(productId, assignmentMap)
    }
    return { current, labelCache: new Map() }
  },

  async applyImportedRow(productId: string, row: Record<string, string>, ctx?: unknown): Promise<boolean> {
    const cols = await columnsFor(productId)
    if (cols.length === 0) return false
    const importCtx = isProdImportCtx(ctx) ? ctx : undefined
    const rowByLower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    let changed = false
    for (const col of cols) {
      const key = col.name.trim().toLowerCase()
      if (!rowByLower.has(key)) continue // column not in the sheet - leave this helping alone
      const wanted = new Set<string>()
      for (const label of parseLabels(rowByLower.get(key) ?? '')) {
        const cacheKey = `${col.attributeId}|${label.toLowerCase()}`
        let valueId: string | null
        if (importCtx?.labelCache.has(cacheKey)) {
          valueId = importCtx.labelCache.get(cacheKey) ?? null
        } else {
          valueId = await ensureAttributeValueByLabel(col.attributeId, label)
          importCtx?.labelCache.set(cacheKey, valueId)
        }
        if (valueId) wanted.add(valueId)
      }
      if (sameSet(currentValueIds(importCtx, productId, col.assignmentId), wanted)) continue
      await setProductAssignmentValues(productId, col.assignmentId, [...wanted])
      changed = true
      if (importCtx) {
        const byAssignment = importCtx.current.get(productId) ?? new Map<string, Set<string>>()
        byAssignment.set(col.assignmentId, wanted)
        importCtx.current.set(productId, byAssignment)
      }
    }
    return changed
  },

  // Read-only twin of applyImportedRow for the Pull's diff. Resolves each cell's
  // wanted ids without creating any, and compares to what is stored. A non-empty
  // label the vocabulary has not seen yet has no id here but apply would create and
  // tick it, so it always counts as a change.
  async rowChanged(productId: string, row: Record<string, string>, ctx?: unknown): Promise<boolean> {
    const cols = await columnsFor(productId)
    if (cols.length === 0) return false
    const importCtx = isProdImportCtx(ctx) ? ctx : undefined
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
    return false
  },
}
