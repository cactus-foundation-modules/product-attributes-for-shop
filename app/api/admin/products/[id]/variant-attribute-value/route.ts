import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductAttributes, setVariantAttributeValue } from '@/modules/product-attributes-for-shop/lib/db/membership'
import { getAttributeValueOwner } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { listVariantsForProduct } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

const Body = z.object({
  childProductId: z.string(),
  // The helping (a single "use for variations" block on this product), not the
  // attribute: one attribute can be two columns, and only this tells them apart.
  assignmentId: z.string(),
  valueId: z.string().nullable(),
})

// Sets one variant's value for one use-for-variations helping. Every id is
// checked against this product so a crafted request can neither write another
// product's variant nor attach a value from the wrong attribute.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { childProductId, assignmentId, valueId } = parsed.data

  const variants = await listVariantsForProduct(id)
  if (!variants.some((v) => v.childProductId === childProductId)) {
    return NextResponse.json({ error: 'Unknown variant for this product' }, { status: 400 })
  }

  // Looking the helping up on this product is what stops a crafted request
  // writing against a helping that belongs to somebody else's product.
  const membership = await getProductAttributes(id)
  const helping = membership.find((m) => m.id === assignmentId && m.useForVariations)
  if (!helping) {
    return NextResponse.json({ error: 'That attribute is not used for this product’s variations' }, { status: 400 })
  }

  if (valueId) {
    const owner = await getAttributeValueOwner(valueId)
    if (!owner || owner.attributeId !== helping.attributeId) {
      return NextResponse.json({ error: 'Value does not belong to that attribute' }, { status: 400 })
    }
  }

  await setVariantAttributeValue(childProductId, assignmentId, valueId)
  return NextResponse.json({ ok: true })
}
