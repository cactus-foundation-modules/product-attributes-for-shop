import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductAssignments, setProductValueIds } from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { listVariantsForProduct } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'

// Everything the product editor's attributes panel needs in one round trip: the
// attribute vocabulary, this product's assignments, and its variants (empty when
// shop-variations is not installed).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  const [attributes, assignments, variants] = await Promise.all([
    listAttributes(),
    getProductAssignments(id),
    listVariantsForProduct(id),
  ])
  return NextResponse.json({ attributes, assignments, variants })
}

const PutBody = z.object({
  // Values on the product itself.
  own: z.array(z.string()).max(200),
  // Values per variant child product id. Absent keys are left untouched.
  byVariant: z.record(z.string(), z.array(z.string()).max(200)).optional(),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PutBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  await setProductValueIds(id, parsed.data.own)

  if (parsed.data.byVariant) {
    // Only variants that genuinely belong to this product may be written -
    // otherwise a crafted id could rewrite another product's assignments.
    const variants = await listVariantsForProduct(id)
    const owned = new Set(variants.map((v) => v.childProductId))
    for (const [childProductId, valueIds] of Object.entries(parsed.data.byVariant)) {
      if (!owned.has(childProductId)) {
        return NextResponse.json({ error: 'Unknown variant for this product' }, { status: 400 })
      }
      await setProductValueIds(childProductId, valueIds)
    }
  }

  return NextResponse.json({ ok: true })
}
