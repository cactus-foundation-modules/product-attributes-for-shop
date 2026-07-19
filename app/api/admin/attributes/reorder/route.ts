import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listAttributes, setAttributePositions } from '@/modules/product-attributes-for-shop/lib/db/attributes'

// The whole running order, not a "move this one up". The screen already knows
// the order it is showing - sending it back wholesale means the server never has
// to guess what "up" meant across a grouped layout, and two admins reordering at
// once end with one of the two orders rather than an interleaved mess.
const Body = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { ids } = parsed.data
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Refuse a partial list. A short one would silently renumber the attributes it
  // names to 0..n and leave everything else on its old number, quietly shuffling
  // rows nobody touched - so the order the caller sends must be the whole shop's.
  const existing = await listAttributes()
  const known = new Set(existing.map((a) => a.id))
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    return NextResponse.json({ error: 'That list is out of date - reload the page and try again.' }, { status: 409 })
  }

  await setAttributePositions(ids)
  return NextResponse.json({ ok: true })
}
