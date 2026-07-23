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

vi.mock('@/modules/product-attributes-for-shop/lib/db/membership', () => ({
  listProductLevelColumns: (...a: unknown[]) => listProductLevelColumns(...(a as [string])),
  ensureAttributeValueByLabel: (...a: unknown[]) => ensureAttributeValueByLabel(...(a as [string, string])),
  findAttributeValueByLabel: (...a: unknown[]) => findAttributeValueByLabel(...(a as [string, string])),
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
