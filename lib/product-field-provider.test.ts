import { describe, it, expect, vi, beforeEach } from 'vitest'

// One product-level helping. The provider caches columns per product for 10s, so
// each test uses a fresh product id to keep the cache from bleeding across cases.
const listProductLevelColumns = vi.fn(async (_id: string) => [
  { assignmentId: 'asg1', attributeId: 'attr1', name: 'Markup', position: 0 },
])
const ensureAttributeValueByLabel = vi.fn(async (_a: string, label: string): Promise<string | null> => `v-${label.toLowerCase()}`)
const findAttributeValueByLabel = vi.fn(async (_a: string, label: string): Promise<string | null> =>
  label.toLowerCase().startsWith('new') ? null : `v-${label.toLowerCase()}`,
)
const getProductOwnValuesByAssignment = vi.fn(async (_ids: string[]): Promise<Record<string, Record<string, string[]>>> => ({}))
const getProductOwnValueIdsByAssignment = vi.fn(async (_ids: string[]): Promise<Record<string, Record<string, string[]>>> => ({}))
const setProductAssignmentValues = vi.fn(async (_p: string, _a: string, _v: string[]) => {})
// Attribute vocabulary for auto-attach: "Fabric" is a known attribute a product
// may not yet use at product level. Empty by default so the base cases (no
// auto-attach) behave exactly as before; cases that exercise auto-attach seed it.
const listAllAttributes = vi.fn(async (): Promise<{ id: string; name: string }[]> => [])
const upsertProductLevelAttribute = vi.fn(async (_p: string, _a: string): Promise<string | null> => null)

vi.mock('@/modules/product-attributes-for-shop/lib/db/membership', () => ({
  listProductLevelColumns: (...a: unknown[]) => listProductLevelColumns(...(a as [string])),
  ensureAttributeValueByLabel: (...a: unknown[]) => ensureAttributeValueByLabel(...(a as [string, string])),
  findAttributeValueByLabel: (...a: unknown[]) => findAttributeValueByLabel(...(a as [string, string])),
  listAllAttributes: (...a: unknown[]) => listAllAttributes(...(a as [])),
  upsertProductLevelAttribute: (...a: unknown[]) => upsertProductLevelAttribute(...(a as [string, string])),
}))
vi.mock('@/modules/product-attributes-for-shop/lib/db/assignments', () => ({
  getProductOwnValuesByAssignment: (...a: unknown[]) => getProductOwnValuesByAssignment(...(a as [string[]])),
  getProductOwnValueIdsByAssignment: (...a: unknown[]) => getProductOwnValueIdsByAssignment(...(a as [string[]])),
  setProductAssignmentValues: (...a: unknown[]) => setProductAssignmentValues(...(a as [string, string, string[]])),
}))

import { productAttributesProductFieldProvider as provider } from '@/modules/product-attributes-for-shop/lib/product-field-provider'

let seq = 0
const nextProduct = () => `product-${seq++}`

beforeEach(() => {
  listProductLevelColumns.mockClear()
  ensureAttributeValueByLabel.mockClear()
  findAttributeValueByLabel.mockClear()
  getProductOwnValuesByAssignment.mockClear()
  getProductOwnValueIdsByAssignment.mockClear()
  setProductAssignmentValues.mockClear()
  listAllAttributes.mockClear()
  // "Fabric" is a known attribute throughout; the provider caches this vocabulary
  // for 10s (longer than the suite), so it must stay constant across tests. Base
  // cases never use a "Fabric" header, so they see no auto-attach.
  listAllAttributes.mockResolvedValue([{ id: 'attr-fabric', name: 'Fabric' }])
  upsertProductLevelAttribute.mockClear()
  upsertProductLevelAttribute.mockResolvedValue(null)
})

describe('productAttributesProductFieldProvider columns and values', () => {
  it('lists one column per product-level helping', async () => {
    expect(await provider.listColumns(nextProduct())).toEqual([{ key: 'asg1', label: 'Markup', order: 0 }])
  })

  it('serialises multi-select ticks comma-separated', async () => {
    getProductOwnValuesByAssignment.mockResolvedValueOnce({ p1: { asg1: ['Premium', 'Trade'] } })
    expect(await provider.getValues(['p1'])).toEqual({ p1: { asg1: 'Premium, Trade' } })
  })
})

describe('productAttributesProductFieldProvider.applyImportedRow', () => {
  it('writes a value and reports the change', async () => {
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({})
    const p = nextProduct()
    const ctx = await provider.beginImport(['p1'])
    const changed = await provider.applyImportedRow(p, { Markup: 'Premium' }, ctx)
    expect(changed).toBe(true)
    expect(setProductAssignmentValues).toHaveBeenCalledWith(p, 'asg1', ['v-premium'])
  })

  it('skips the write when the resolved set is unchanged', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    const changed = await provider.applyImportedRow(p, { Markup: 'Red' }, ctx)
    expect(changed).toBe(false)
    expect(setProductAssignmentValues).not.toHaveBeenCalled()
  })

  it('replaces the whole set for a multi-value cell', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    await provider.applyImportedRow(p, { Markup: 'Red, Blue' }, ctx)
    expect(setProductAssignmentValues).toHaveBeenCalledWith(p, 'asg1', ['v-red', 'v-blue'])
  })

  it('clears the helping when a present cell is emptied', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    const changed = await provider.applyImportedRow(p, { Markup: '' }, ctx)
    expect(changed).toBe(true)
    expect(setProductAssignmentValues).toHaveBeenCalledWith(p, 'asg1', [])
  })

  it('leaves the helping alone when its column is absent from the sheet', async () => {
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({})
    const ctx = await provider.beginImport([])
    const changed = await provider.applyImportedRow(nextProduct(), { 'Other Column': 'x' }, ctx)
    expect(changed).toBe(false)
    expect(setProductAssignmentValues).not.toHaveBeenCalled()
  })

  it('writes for a product absent from the preload (context miss)', async () => {
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({})
    const ctx = await provider.beginImport([])
    const changed = await provider.applyImportedRow(nextProduct(), { Markup: 'Green' }, ctx)
    expect(changed).toBe(true)
    expect(setProductAssignmentValues).toHaveBeenCalledWith(expect.any(String), 'asg1', ['v-green'])
  })
})

describe('productAttributesProductFieldProvider.applyImportedRow auto-attach', () => {
  it('attaches an existing attribute typed into a new column and ticks the value', async () => {
    const p = nextProduct()
    upsertProductLevelAttribute.mockResolvedValueOnce('asg-fabric')
    const ctx = await provider.beginImport([p])
    const changed = await provider.applyImportedRow(p, { Markup: '', Fabric: 'Velvet' }, ctx)
    expect(changed).toBe(true)
    expect(upsertProductLevelAttribute).toHaveBeenCalledWith(p, 'attr-fabric')
    expect(setProductAssignmentValues).toHaveBeenCalledWith(p, 'asg-fabric', ['v-velvet'])
  })

  it('ticks several values for a multi-select auto-attach cell', async () => {
    const p = nextProduct()
    upsertProductLevelAttribute.mockResolvedValueOnce('asg-fabric')
    const ctx = await provider.beginImport([p])
    await provider.applyImportedRow(p, { Fabric: 'Velvet, Cotton' }, ctx)
    expect(setProductAssignmentValues).toHaveBeenCalledWith(p, 'asg-fabric', ['v-velvet', 'v-cotton'])
  })

  it('never touches a fixed product column that shares an attribute name', async () => {
    const p = nextProduct()
    // "Supplier" is a fixed CSV column, so even if an attribute were named that it
    // must not auto-attach. No attribute here is named Supplier anyway.
    const ctx = await provider.beginImport([p])
    const changed = await provider.applyImportedRow(p, { supplier: 'Acme' }, ctx)
    expect(changed).toBe(false)
    expect(upsertProductLevelAttribute).not.toHaveBeenCalled()
  })

  it('leaves the product alone when only a variation helping exists (upsert declines)', async () => {
    const p = nextProduct()
    upsertProductLevelAttribute.mockResolvedValueOnce(null) // slot owned by a variation helping
    const ctx = await provider.beginImport([p])
    const changed = await provider.applyImportedRow(p, { Fabric: 'Velvet' }, ctx)
    expect(changed).toBe(false)
    expect(setProductAssignmentValues).not.toHaveBeenCalled()
  })

  it('does not attach an unknown column heading', async () => {
    const p = nextProduct()
    const ctx = await provider.beginImport([p])
    const changed = await provider.applyImportedRow(p, { 'Made Up': 'x' }, ctx)
    expect(changed).toBe(false)
    expect(upsertProductLevelAttribute).not.toHaveBeenCalled()
  })
})

describe('productAttributesProductFieldProvider.rowChanged auto-attach (read-only)', () => {
  it('flags a value typed into a new attribute column as a change', async () => {
    const p = nextProduct()
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { Fabric: 'Velvet' }, ctx)).toBe(true)
    expect(upsertProductLevelAttribute).not.toHaveBeenCalled()
  })

  it('is false for a blank cell in a new attribute column', async () => {
    const p = nextProduct()
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { Fabric: '' }, ctx)).toBe(false)
  })

  it('is false for a fixed product column', async () => {
    const p = nextProduct()
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { supplier: 'Acme' }, ctx)).toBe(false)
  })
})

describe('productAttributesProductFieldProvider.rowChanged (read-only)', () => {
  it('is false when the resolved set matches', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { Markup: 'Red' }, ctx)).toBe(false)
    expect(ensureAttributeValueByLabel).not.toHaveBeenCalled()
  })

  it('is true when the set differs', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { Markup: 'Blue' }, ctx)).toBe(true)
  })

  it('is true for a label the vocabulary has not seen yet', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { Markup: 'Newish' }, ctx)).toBe(true)
    expect(ensureAttributeValueByLabel).not.toHaveBeenCalled()
  })

  it('is true when a present cell is emptied over stored ticks', async () => {
    const p = nextProduct()
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({ [p]: { asg1: ['v-red'] } })
    const ctx = await provider.beginImport([p])
    expect(await provider.rowChanged(p, { Markup: '' }, ctx)).toBe(true)
  })

  it('is false when the column is absent from the sheet', async () => {
    getProductOwnValueIdsByAssignment.mockResolvedValueOnce({})
    const ctx = await provider.beginImport([])
    expect(await provider.rowChanged(nextProduct(), { 'Other Column': 'x' }, ctx)).toBe(false)
  })
})
