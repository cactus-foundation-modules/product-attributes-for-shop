import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  listAttributeGroups,
  createAttributeGroup,
  attributeGroupNameTaken,
  ensureUniqueGroupSlug,
  nextAttributeGroupPosition,
} from '@/modules/product-attributes-for-shop/lib/db/groups'

export async function GET() {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const groups = await listAttributeGroups()
  return NextResponse.json({ groups })
}

const PostBody = z.object({
  name: z.string().min(1).max(80),
})

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = PostBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const name = parsed.data.name.trim()
  if (!name) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (await attributeGroupNameTaken(name, '')) {
    return NextResponse.json({ error: `There is already a group called "${name}".` }, { status: 409 })
  }

  const slug = await ensureUniqueGroupSlug(slugify(name) || 'group')
  const created = await createAttributeGroup({
    name,
    slug,
    position: await nextAttributeGroupPosition(),
  })
  return NextResponse.json({ id: created.id, slug })
}
