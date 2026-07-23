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

vi.mock('@/modules/product-attributes-for-shop/lib/db/membership', () => ({
  listVariationColumns: (...a: unknown[]) => listVariationColumns(...(a as [string])),
  getVariantAttributeValues: (...a: unknown[]) => getVariantAttributeValues(...(a as [string, string[]])),
  setVariantAttributeValue: (...a: unknown[]) => setVariantAttributeValue(...(a as [string, string, string | null])),
  ensureAttributeValueByLabel: (...a: unknown[]) => ensureAttributeValueByLabel(...(a as [string, string])),
  findAttributeValueByLabel: (...a: unknown[]) => findAttributeValueByLabel(...(a as [string, string])),
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
