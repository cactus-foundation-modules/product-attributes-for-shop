import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PatVariationColumn } from '@/modules/product-attributes-for-shop/lib/types'

// Stub the admin Cell (a client component) and the db layer - neither is what the
// import batching under test exercises.
vi.mock('@/modules/product-attributes-for-shop/components/admin/ProductAttributesVariantCell', () => ({
  ProductAttributesVariantCell: () => null,
}))

// One attribute standing up as two columns - the case the whole assignment key
// exists for. Both draw on attr1; only the assignment id tells them apart.
const listVariationColumns = vi.fn(async (_id: string): Promise<PatVariationColumn[]> => [
  { assignmentId: 'asg1', attributeId: 'attr1', name: 'Main finish', position: 0, values: [] },
  { assignmentId: 'asg2', attributeId: 'attr1', name: 'Edge finish', position: 1, values: [] },
])
const getVariantAttributeValues = vi.fn(
  async (_p: string, _c: string[]): Promise<Record<string, Record<string, { valueId: string; label: string }>>> => ({}),
)
const setVariantAttributeValue = vi.fn(async (_c: string, _assignmentId: string, _v: string | null) => {})
const ensureAttributeValueByLabel = vi.fn(async (_a: string, label: string): Promise<string | null> => `v-${label.toLowerCase()}`)
// Read-only lookup. A label starting "new" stands for one the vocabulary has not
// seen yet: no id. Everything else resolves the same way ensure would, minus the
// create - so the preview sees a known label as its id and an unknown one as null.
const findAttributeValueByLabel = vi.fn(async (_a: string, label: string): Promise<string | null> =>
  label.toLowerCase().startsWith('new') ? null : `v-${label.toLowerCase()}`,
)
// The vocabulary a live site would hold. "Catalog" and "Supplier" are both real
// attributes here: an UNMARKED heading naming either must still attach nothing,
// and "Supplier" must be refused even when marked, because it is shop-variations'
// own column.
const listAllAttributes = vi.fn(async (): Promise<{ id: string; name: string }[]> => [
  { id: 'attr1', name: 'Finish' },
  { id: 'attr-catalog', name: 'Catalog' },
  { id: 'attr-supplier', name: 'Supplier' },
  { id: 'attr-shipping', name: 'Shipping' },
])
// Hands back a new variation helping. null stands for the one case it refuses:
// the un-named helping for that attribute is the owner's product-level one.
const upsertVariationAttribute = vi.fn(
  async (_p: string, attributeId: string): Promise<string | null> => `asg-${attributeId}`,
)
// Pairs the owner has taken off by hand. Empty unless a test says otherwise.
const listVariationAttachBlocks = vi.fn(async (_ids: string[]): Promise<Set<string>> => new Set())
// Pairs whose auto-attach would decline because the un-named helping is the
// owner's product-level one. Empty unless a test says otherwise.
const listAutoAttachDeclines = vi.fn(async (_ids: string[], _v: boolean): Promise<Set<string>> => new Set())

vi.mock('@/modules/product-attributes-for-shop/lib/db/membership', () => ({
  listVariationColumns: (...a: unknown[]) => listVariationColumns(...(a as [string])),
  getVariantAttributeValues: (...a: unknown[]) => getVariantAttributeValues(...(a as [string, string[]])),
  setVariantAttributeValue: (...a: unknown[]) => setVariantAttributeValue(...(a as [string, string, string | null])),
  ensureAttributeValueByLabel: (...a: unknown[]) => ensureAttributeValueByLabel(...(a as [string, string])),
  findAttributeValueByLabel: (...a: unknown[]) => findAttributeValueByLabel(...(a as [string, string])),
  listAllAttributes: (...a: unknown[]) => listAllAttributes(...(a as [])),
  upsertVariationAttribute: (...a: unknown[]) => upsertVariationAttribute(...(a as [string, string])),
  listVariationAttachBlocks: (...a: unknown[]) => listVariationAttachBlocks(...(a as [string[]])),
  listAutoAttachDeclines: (...a: unknown[]) => listAutoAttachDeclines(...(a as [string[], boolean])),
}))

import { productAttributesVariantFieldProvider as provider } from '@/modules/product-attributes-for-shop/lib/variant-field-provider'

// Distinct parent id per test so the 10s columnsFor cache never bleeds across cases.
let seq = 0
const nextParent = () => `parent-${seq++}`

beforeEach(() => {
  listVariationColumns.mockClear()
  getVariantAttributeValues.mockClear()
  setVariantAttributeValue.mockClear()
  ensureAttributeValueByLabel.mockClear()
  findAttributeValueByLabel.mockClear()
  listAllAttributes.mockClear()
  upsertVariationAttribute.mockClear()
  listVariationAttachBlocks.mockClear()
  listAutoAttachDeclines.mockClear()
})

describe('productAttributesVariantFieldProvider import batching', () => {
  it('beginImport preloads all children in one read', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    await provider.beginImport!(parent, ['c1', 'c2'])
    expect(getVariantAttributeValues).toHaveBeenCalledTimes(1)
    expect(getVariantAttributeValues).toHaveBeenCalledWith(parent, ['c1', 'c2'])
  })

  it('skips the write when the resolved value is unchanged', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': 'Red' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('writes when the resolved value differs', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': 'Blue' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledTimes(1)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg1', 'v-blue')
  })

  it('writes for a brand-new variant absent from the preload (context miss)', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({}) // c1 created mid-import
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, [])
    await provider.applyImportedRow(parent, 'fresh', { 'Main finish': 'Green' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('fresh', 'asg1', 'v-green')
  })

  it('clears the value when a present cell is empty and one was stored', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': '' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg1', null)
  })

  it('no write when an empty cell matches an already-empty value', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': '' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('resolves each label once across many rows (label cache)', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, [])
    await provider.applyImportedRow(parent, 'a', { 'Main finish': 'Red' }, ctx)
    await provider.applyImportedRow(parent, 'b', { 'Main finish': 'Red' }, ctx)
    expect(ensureAttributeValueByLabel).toHaveBeenCalledTimes(1)
    expect(setVariantAttributeValue).toHaveBeenCalledTimes(2)
  })

  it('ignores columns the sheet does not carry', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, [])
    await provider.applyImportedRow(parent, 'c1', { 'Some Other Column': 'x' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })
})

describe('productAttributesVariantFieldProvider.rowChanged (preview, read-only)', () => {
  it('is false when the resolved value matches what is stored', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': 'Red' }, ctx)).toBe(false)
    expect(ensureAttributeValueByLabel).not.toHaveBeenCalled() // never creates
  })

  it('is true when the resolved value differs', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': 'Blue' }, ctx)).toBe(true)
  })

  it('is true for a label the vocabulary has not seen yet (apply would create it)', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': 'Newish' }, ctx)).toBe(true)
    expect(ensureAttributeValueByLabel).not.toHaveBeenCalled() // still creates nothing
  })

  // The regression that lost Google-Sheet Pull edits: a brand-new attribute whose
  // cells all started empty (nothing stored, so `stored` is null), the owner
  // typing its first value in the sheet - a label the vocabulary has not seen yet,
  // so the read-only resolve is also null. null === null read as "no change", the
  // Pull dropped the row, and the fresh value never imported. applyImportedRow
  // would create and assign it, so rowChanged must call it a change.
  it('is true for a new label typed into a previously-empty cell (nothing stored)', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({}) // c1 has no value for this assignment
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': 'Newish' }, ctx)).toBe(true)
    expect(ensureAttributeValueByLabel).not.toHaveBeenCalled() // preview still creates nothing
  })

  it('is true when a present cell is emptied over a stored value', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': '' }, ctx)).toBe(true)
  })

  it('is false when an empty cell matches an already-empty value', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': '' }, ctx)).toBe(false)
  })

  it('is false when the sheet lacks the column, and writes nothing', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Some Other Column': 'x' }, ctx)).toBe(false)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  // The preview walks every variation row in the sheet in one request. Resolving
  // the same label from the database once per row put a catalogue of a few hundred
  // variants over the sixty-second ceiling, and the Pull dialog reported it as a
  // sheet it could not read. One lookup per distinct label, whatever the row count.
  it('resolves each label once across rows, not once per row', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1', 'c2', 'c3'])
    for (const child of ['c1', 'c2', 'c3']) {
      await provider.rowChanged!(parent, child, { 'Main finish': 'Oak' }, ctx)
    }
    expect(findAttributeValueByLabel).toHaveBeenCalledTimes(1)
  })

  // A label with no id is the expensive case: it can never be "found", so without
  // caching the miss it was re-queried on every single row.
  it('caches a label the vocabulary does not have, rather than asking again', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({
      'c1': { asg1: { valueId: 'v-red', label: 'Red' } },
      'c2': { asg1: { valueId: 'v-red', label: 'Red' } },
    })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1', 'c2'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': 'Newish' }, ctx)).toBe(true)
    expect(await provider.rowChanged!(parent, 'c2', { 'Main finish': 'Newish' }, ctx)).toBe(true)
    expect(findAttributeValueByLabel).toHaveBeenCalledTimes(1)
  })
})

// One attribute, two columns. Before the column key became the assignment id
// these all collapsed into one another: the second write wiped the first, and a
// value stored under one heading read back under both.
describe('an attribute used for variations more than once', () => {
  it('gives each helping its own column key', async () => {
    const cols = await provider.listColumns(nextParent())
    expect(cols).toEqual([
      { key: 'asg1', label: 'Main finish', order: 0 },
      { key: 'asg2', label: 'Edge finish', order: 1 },
    ])
  })

  it('writes each column against its own helping', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': 'Oak', 'Edge finish': 'White' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg1', 'v-oak')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg2', 'v-white')
  })

  it('keeps the two apart when they hold the same value', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': 'Oak', 'Edge finish': 'Oak' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg1', 'v-oak')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg2', 'v-oak')
    // Same vocabulary, so the label is resolved once for both columns.
    expect(ensureAttributeValueByLabel).toHaveBeenCalledTimes(1)
    expect(ensureAttributeValueByLabel).toHaveBeenCalledWith('attr1', 'Oak')
  })

  it('leaves the other column alone when only one changes', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({
      'c1': { asg1: { valueId: 'v-oak', label: 'Oak' }, asg2: { valueId: 'v-white', label: 'White' } },
    })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': 'Oak', 'Edge finish': 'Walnut' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledTimes(1)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg2', 'v-walnut')
  })
})


// An import fills the columns a product already has, and ATTACHES an attribute a
// heading names that the product does not carry yet - no marker, no ceremony.
//
// What makes that safe rather than the trap it was in v0.1.35 is that it is
// reversible: taking the column off on the Attributes tab records a block, and no
// heading ever puts a blocked pair back. The refusal itself lives in SQL
// (`upsertVariationAttribute`), which is why these tests drive it through the
// mock's null return rather than asserting on a query.
describe('a heading naming an attribute the product does not carry', () => {
  it('attaches the attribute and writes the value', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': 'Flat pack' }, ctx)
    expect(upsertVariationAttribute).toHaveBeenCalledTimes(1)
    expect(upsertVariationAttribute).toHaveBeenCalledWith(parent, 'attr-shipping')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg-attr-shipping', 'v-flat pack')
  })

  it('works on a product with no variation columns at all', async () => {
    listVariationColumns.mockResolvedValueOnce([])
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)
    expect(upsertVariationAttribute).toHaveBeenCalledWith(parent, 'attr-shipping')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg-attr-shipping', 'v-pallet')
  })

  it('attaches once across many rows, not once per row', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1', 'c2'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)
    await provider.applyImportedRow(parent, 'c2', { 'Shipping': 'Pallet' }, ctx)
    expect(upsertVariationAttribute).toHaveBeenCalledTimes(1)
    expect(setVariantAttributeValue).toHaveBeenCalledTimes(2)
  })

  it('attaches several attributes off one row', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': 'Pallet', 'Catalog': 'Seating' }, ctx)
    expect(upsertVariationAttribute).toHaveBeenCalledTimes(2)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg-attr-shipping', 'v-pallet')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg-attr-catalog', 'v-seating')
  })

  it('still fills the columns the product does have alongside attaching a new one', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Main finish': 'Oak', 'Shipping': 'Pallet' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg1', 'v-oak')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg-attr-shipping', 'v-pallet')
    expect(upsertVariationAttribute).toHaveBeenCalledTimes(1) // only the new one
  })

  // The refusal that the whole rebuild turns on: the owner already uses this
  // attribute as ordinary product information, so its un-named helping is theirs.
  it('leaves the product alone when the helping is the owner\'s product-level one', async () => {
    upsertVariationAttribute.mockResolvedValueOnce(null)
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('leaves shop-variations\' own columns alone', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    // "Supplier" is a real attribute in the vocabulary here, and also
    // shop-variations' own column. The sheet's own columns always win.
    await provider.applyImportedRow(parent, 'c1', { 'Supplier': 'Acme', 'Option 1': 'Colour' }, ctx)
    expect(upsertVariationAttribute).not.toHaveBeenCalled()
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('an unknown heading is left alone', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Made Up Column': 'x' }, ctx)
    expect(upsertVariationAttribute).not.toHaveBeenCalled()
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('does nothing on a blank cell - an empty column attaches nothing', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': '   ' }, ctx)
    expect(upsertVariationAttribute).not.toHaveBeenCalled()
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  // v0.1.58 asked for a star. A sheet still carrying one must not quietly stop
  // working while it waits for the Push that clears it.
  it('tolerates a heading still carrying the old star', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping *': 'Pallet' }, ctx)
    expect(upsertVariationAttribute).toHaveBeenCalledWith(parent, 'attr-shipping')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg-attr-shipping', 'v-pallet')
  })

  it('rowChanged counts an attach as a change, and attaches nothing itself', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)).toBe(true)
    expect(upsertVariationAttribute).not.toHaveBeenCalled()
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
    expect(ensureAttributeValueByLabel).not.toHaveBeenCalled()
  })

  it('rowChanged is false for a blank cell', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Shipping': '' }, ctx)).toBe(false)
  })

  it('rowChanged is false for a heading naming no attribute that exists', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Made Up Column': 'x' }, ctx)).toBe(false)
  })
})

// The half that makes auto-attach reversible. Without it, deleting a column on
// the Attributes tab lasted until the next Pull put it straight back - which is
// exactly why the feature was taken out in v0.1.35.
describe('an attribute the owner has taken off a product by hand', () => {
  it('is not put back by a heading, and nothing is written', async () => {
    // The block is enforced inside the INSERT, so the refusal arrives as null.
    upsertVariationAttribute.mockResolvedValueOnce(null)
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('does not keep showing up as a change in the preview', async () => {
    const parent = nextParent()
    listVariationAttachBlocks.mockResolvedValueOnce(new Set([`${parent}|attr-shipping`]))
    getVariantAttributeValues.mockResolvedValueOnce({})
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)).toBe(false)
  })

  it('blocks that pair only - another attribute on the same product still attaches', async () => {
    const parent = nextParent()
    listVariationAttachBlocks.mockResolvedValueOnce(new Set([`${parent}|attr-shipping`]))
    getVariantAttributeValues.mockResolvedValueOnce({})
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Catalog': 'Seating' }, ctx)).toBe(true)
  })

  // One context now covers many parents (beginImportMany), so the block key has
  // to carry the product. Keyed on the attribute alone, one product's removal
  // would silently mute the attach on every other product in the batch.
  it('blocks it on that product only - the same attribute elsewhere still attaches', async () => {
    const blocked = nextParent()
    const other = nextParent()
    listVariationAttachBlocks.mockResolvedValueOnce(new Set([`${blocked}|attr-shipping`]))
    getVariantAttributeValues.mockResolvedValueOnce({})
    const ctx = await provider.beginImport!(blocked, ['c1'])
    expect(await provider.rowChanged!(blocked, 'c1', { 'Shipping': 'Pallet' }, ctx)).toBe(false)
    expect(await provider.rowChanged!(other, 'c2', { 'Shipping': 'Pallet' }, ctx)).toBe(true)
  })
})

// The pair of defects that made a Pull immortal: 13,691 variations offered up for
// update on every run of a live catalogue, "updated" without complaint, then
// offered up again, unchanged, for ever.
describe('a change the preview reports is a change the import then makes', () => {
  // shop-variations' importer asks rowChanged and then applyImportedRow with the
  // SAME context. rowChanged's lookup never creates a value, so a label the
  // vocabulary has not seen resolves to null - and caching that null where the
  // write path reads it told applyCellValue there was nothing to store. The value
  // was never created, the cell never written, and the row came back next time.
  it('a label new to the vocabulary is still created when rowChanged asked first', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    const row = { 'Main finish': 'New Oak' }
    expect(await provider.rowChanged!(parent, 'c1', row, ctx)).toBe(true)
    await provider.applyImportedRow(parent, 'c1', row, ctx)
    expect(ensureAttributeValueByLabel).toHaveBeenCalledWith('attr1', 'New Oak')
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'asg1', 'v-new oak')
  })

  // And with that write made, the next Pull's compare says nothing to do.
  it('and the next run reports it as unchanged', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { asg1: { valueId: 'v-new oak', label: 'New Oak' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    findAttributeValueByLabel.mockResolvedValueOnce('v-new oak')
    expect(await provider.rowChanged!(parent, 'c1', { 'Main finish': 'New Oak' }, ctx)).toBe(false)
  })

  // The other half: a heading naming an attribute whose un-named helping is the
  // owner's product-level one. upsertVariationAttribute declines rather than flip
  // it, so the preview must decline to report it - it was counting a change that
  // could never be made.
  it('an attach the import would decline is not reported as a change', async () => {
    const parent = nextParent()
    listAutoAttachDeclines.mockResolvedValueOnce(new Set([`${parent}|attr-shipping`]))
    getVariantAttributeValues.mockResolvedValueOnce({})
    const ctx = await provider.beginImport!(parent, ['c1'])
    expect(await provider.rowChanged!(parent, 'c1', { 'Shipping': 'Pallet' }, ctx)).toBe(false)
    // That product only, and that attribute only.
    expect(await provider.rowChanged!(parent, 'c1', { 'Catalog': 'Seating' }, ctx)).toBe(true)
    expect(await provider.rowChanged!(nextParent(), 'c2', { 'Shipping': 'Pallet' }, ctx)).toBe(true)
  })
})
