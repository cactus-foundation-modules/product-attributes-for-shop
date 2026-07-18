import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PatVariationColumn } from '@/modules/product-attributes-for-shop/lib/types'

// Stub the admin Cell (a client component) and the db layer - neither is what the
// import batching under test exercises.
vi.mock('@/modules/product-attributes-for-shop/components/admin/ProductAttributesVariantCell', () => ({
  ProductAttributesVariantCell: () => null,
}))

const listVariationColumns = vi.fn(async (_id: string): Promise<PatVariationColumn[]> => [
  { attributeId: 'attr1', name: 'Colour', position: 0, values: [] },
])
const getVariantAttributeValues = vi.fn(
  async (_p: string, _c: string[]): Promise<Record<string, Record<string, { valueId: string; label: string }>>> => ({}),
)
const setVariantAttributeValue = vi.fn(async (_c: string, _a: string, _v: string | null) => {})
const ensureAttributeValueByLabel = vi.fn(async (_a: string, label: string): Promise<string | null> => `v-${label.toLowerCase()}`)

vi.mock('@/modules/product-attributes-for-shop/lib/db/membership', () => ({
  listVariationColumns: (...a: unknown[]) => listVariationColumns(...(a as [string])),
  getVariantAttributeValues: (...a: unknown[]) => getVariantAttributeValues(...(a as [string, string[]])),
  setVariantAttributeValue: (...a: unknown[]) => setVariantAttributeValue(...(a as [string, string, string | null])),
  ensureAttributeValueByLabel: (...a: unknown[]) => ensureAttributeValueByLabel(...(a as [string, string])),
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
})

describe('productAttributesVariantFieldProvider import batching', () => {
  it('beginImport preloads all children in one read', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { attr1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    await provider.beginImport!(parent, ['c1', 'c2'])
    expect(getVariantAttributeValues).toHaveBeenCalledTimes(1)
    expect(getVariantAttributeValues).toHaveBeenCalledWith(parent, ['c1', 'c2'])
  })

  it('skips the write when the resolved value is unchanged', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { attr1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { Colour: 'Red' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('writes when the resolved value differs', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { attr1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { Colour: 'Blue' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledTimes(1)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'attr1', 'v-blue')
  })

  it('writes for a brand-new variant absent from the preload (context miss)', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({}) // c1 created mid-import
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, [])
    await provider.applyImportedRow(parent, 'fresh', { Colour: 'Green' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('fresh', 'attr1', 'v-green')
  })

  it('clears the value when a present cell is empty and one was stored', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({ 'c1': { attr1: { valueId: 'v-red', label: 'Red' } } })
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { Colour: '' }, ctx)
    expect(setVariantAttributeValue).toHaveBeenCalledWith('c1', 'attr1', null)
  })

  it('no write when an empty cell matches an already-empty value', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, ['c1'])
    await provider.applyImportedRow(parent, 'c1', { Colour: '' }, ctx)
    expect(setVariantAttributeValue).not.toHaveBeenCalled()
  })

  it('resolves each label once across many rows (label cache)', async () => {
    getVariantAttributeValues.mockResolvedValueOnce({})
    const parent = nextParent()
    const ctx = await provider.beginImport!(parent, [])
    await provider.applyImportedRow(parent, 'a', { Colour: 'Red' }, ctx)
    await provider.applyImportedRow(parent, 'b', { Colour: 'Red' }, ctx)
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
