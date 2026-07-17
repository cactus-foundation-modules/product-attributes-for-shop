import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import {
  getProductAssignments,
  setProductValueIds,
  clearImportedValuesForProduct,
} from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { getProductAttributes, setProductAttributes } from '@/modules/product-attributes-for-shop/lib/db/membership'
import { listVariantsForProduct } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { listAttributes, getValueAttributeMap } from '@/modules/product-attributes-for-shop/lib/db/attributes'

// Everything the product editor's attributes panel needs in one round trip: the
// attribute vocabulary, this product's set (which attributes it uses, with their
// two flags), the product-level value assignments, and its variants (empty when
// shop-variations is not installed). Per-variant values are not here - they live
// on the Variations tab column and save themselves.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  const [attributes, assignments, membership, variants] = await Promise.all([
    listAttributes(),
    getProductAssignments(id),
    getProductAttributes(id),
    listVariantsForProduct(id),
  ])
  return NextResponse.json({ attributes, assignments, membership, variants })
}

const PutBody = z.object({
  // Product-level values (for non-variation attributes in the set).
  own: z.array(z.string()).max(500),
  // The product's attribute set with its per-attribute flags.
  membership: z
    .array(
      z.object({
        attributeId: z.string(),
        useForVariations: z.boolean(),
        showInFilters: z.boolean(),
      }),
    )
    .max(200),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PutBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { own, membership } = parsed.data

  // Save the set, then clear assignments for any attribute dropped from it, so a
  // removed attribute stops dragging the product into its filter.
  const before = await getProductAttributes(id)
  await setProductAttributes(id, membership)
  const keptIds = new Set(membership.map((m) => m.attributeId))
  const removed = before.map((m) => m.attributeId).filter((a) => !keptIds.has(a))
  if (removed.length > 0) await clearImportedValuesForProduct(id, removed)

  // A use-for-variations attribute's value belongs on each variant, not on the
  // product as a whole - strip any such value from the product-level set so the
  // parent never carries a variation value.
  const variationIds = new Set(membership.filter((m) => m.useForVariations).map((m) => m.attributeId))
  let ownToSave = own
  if (variationIds.size > 0 && own.length > 0) {
    const valueAttr = await getValueAttributeMap(own)
    ownToSave = own.filter((v) => !variationIds.has(valueAttr.get(v) ?? ''))
  }
  await setProductValueIds(id, ownToSave)

  return NextResponse.json({ ok: true })
}
