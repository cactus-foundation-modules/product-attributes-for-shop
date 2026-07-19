import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listVariationColumns, getVariantAttributeValues } from '@/modules/product-attributes-for-shop/lib/db/membership'
import { listVariantsForProduct } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

// Everything the Variations-tab attribute cells need in one round trip: the
// product's use-for-variations columns (with their selectable values) and the
// current value each variant carries for each. Keyed by child product id then
// assignment id, so a cell reads its own selection with two lookups - and two
// columns off the same attribute read different selections rather than one.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params

  const [columns, variants] = await Promise.all([
    listVariationColumns(id),
    listVariantsForProduct(id),
  ])
  const childIds = variants.map((v) => v.childProductId)
  const byChild = await getVariantAttributeValues(id, childIds)

  const values: Record<string, Record<string, string>> = {}
  for (const [childId, byAssignment] of Object.entries(byChild)) {
    values[childId] = {}
    for (const [assignmentId, v] of Object.entries(byAssignment)) values[childId][assignmentId] = v.valueId
  }

  return NextResponse.json({
    // attributeId comes along for the ride: a cell typing a brand-new value adds
    // it to the attribute's shop-wide list, not to the column.
    columns: columns.map((c) => ({
      assignmentId: c.assignmentId,
      attributeId: c.attributeId,
      name: c.name,
      values: c.values,
    })),
    values,
  })
}
