import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  getAttribute,
  createAttributeValue,
  attributeValueLabelTaken,
  findAttributeValueByLabel,
  ensureUniqueValueSlug,
  nextValuePosition,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'

const PostBody = z.object({
  label: z.string().min(1).max(80),
  swatch: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(),
  // Set by the inline boxes on a product's Attributes and Variations tabs, where
  // a label that already exists means "use that one", not "you have made a
  // mistake". The attributes screen leaves it off and still gets the 409.
  reuseExisting: z.boolean().optional(),
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

  if (parsed.data.reuseExisting) {
    const existing = await findAttributeValueByLabel(id, label)
    if (existing) return NextResponse.json({ value: existing, reused: true })
  } else if (await attributeValueLabelTaken(id, label, '')) {
    return NextResponse.json({ error: `"${attribute.name}" already has a value called "${label}".` }, { status: 409 })
  }

  const slug = await ensureUniqueValueSlug(id, slugify(label) || 'value')
  const swatch = parsed.data.swatch ?? null
  const position = await nextValuePosition(id)
  const created = await createAttributeValue({ attributeId: id, label, slug, swatch, position })
  return NextResponse.json({
    id: created.id,
    slug,
    value: { id: created.id, attributeId: id, label, slug, swatch, position },
    reused: false,
  })
}
