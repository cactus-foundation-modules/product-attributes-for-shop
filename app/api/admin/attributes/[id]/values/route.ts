import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  getAttribute,
  createAttributeValue,
  attributeValueLabelTaken,
  ensureUniqueValueSlug,
  nextValuePosition,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'

const PostBody = z.object({
  label: z.string().min(1).max(80),
  swatch: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PostBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const attribute = await getAttribute(id)
  if (!attribute) return NextResponse.json({ error: 'Attribute not found' }, { status: 404 })

  const label = parsed.data.label.trim()
  if (!label) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (await attributeValueLabelTaken(id, label, '')) {
    return NextResponse.json({ error: `"${attribute.name}" already has a value called "${label}".` }, { status: 409 })
  }

  const slug = await ensureUniqueValueSlug(id, slugify(label) || 'value')
  const created = await createAttributeValue({
    attributeId: id,
    label,
    slug,
    swatch: parsed.data.swatch ?? null,
    position: await nextValuePosition(id),
  })
  return NextResponse.json({ id: created.id, slug })
}
