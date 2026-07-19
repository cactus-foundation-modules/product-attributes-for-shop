import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listAttributeValues, setValuePositions } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { syncSourcedValueOrder } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

const Body = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

// Whole running order for this attribute's values, same whole-list contract as
// the attribute-level reorder (see attributes/reorder/route.ts) - a partial
// list would silently renumber the values it names to 0..n and strand the rest
// on their old position.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id: attributeId } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { ids } = parsed.data
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const existing = await listAttributeValues(attributeId)
  const known = new Set(existing.map((v) => v.id))
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    return NextResponse.json({ error: 'That list is out of date - reload the page and try again.' }, { status: 409 })
  }

  await setValuePositions(ids)

  // The same order pushed out to any variation option copied from this
  // attribute, and the variants already built from those options renumbered to
  // match. Inert on an install without shop-variations, and on one where this
  // attribute was never used as an option source.
  const variations = await syncSourcedValueOrder(ids)

  return NextResponse.json({
    ok: true,
    optionValuesMoved: variations.valuesMoved,
    variantsResequenced: variations.variantsResequenced,
  })
}
