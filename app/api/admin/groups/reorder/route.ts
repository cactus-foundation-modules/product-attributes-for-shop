import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listAttributeGroups, setAttributeGroupPositions } from '@/modules/product-attributes-for-shop/lib/db/groups'

const Body = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

// Same whole-list contract as the attributes reorder, for the same reasons.
export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { ids } = parsed.data
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const existing = await listAttributeGroups()
  const known = new Set(existing.map((g) => g.id))
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    return NextResponse.json({ error: 'That list is out of date - reload the page and try again.' }, { status: 409 })
  }

  await setAttributeGroupPositions(ids)
  return NextResponse.json({ ok: true })
}
