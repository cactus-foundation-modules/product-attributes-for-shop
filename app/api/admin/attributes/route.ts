import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  listAttributes,
  createAttribute,
  attributeNameTaken,
  ensureUniqueAttributeSlug,
  nextAttributePosition,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'

export async function GET() {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const attributes = await listAttributes()
  return NextResponse.json({ attributes })
}

const PostBody = z.object({
  name: z.string().min(1).max(80),
  controlType: z.enum(['CHECKBOX', 'SWATCH', 'DROPDOWN']).default('CHECKBOX'),
})

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = PostBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const name = parsed.data.name.trim()
  if (!name) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (await attributeNameTaken(name, '')) {
    return NextResponse.json({ error: `There is already an attribute called "${name}".` }, { status: 409 })
  }

  const slug = await ensureUniqueAttributeSlug(slugify(name) || 'attribute')
  const created = await createAttribute({
    name,
    slug,
    controlType: parsed.data.controlType,
    position: await nextAttributePosition(),
  })
  return NextResponse.json({ id: created.id, slug })
}
