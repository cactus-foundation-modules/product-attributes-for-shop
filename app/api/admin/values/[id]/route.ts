import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  updateAttributeValue,
  deleteAttributeValue,
  getAttributeValueOwner,
  attributeValueLabelTaken,
  ensureUniqueValueSlug,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'

const PatchBody = z.object({
  label: z.string().min(1).max(80).optional(),
  swatch: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(),
  position: z.number().int().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const label = parsed.data.label?.trim()
  let slug: string | undefined
  if (label !== undefined) {
    if (!label) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const owner = await getAttributeValueOwner(id)
    if (!owner) return NextResponse.json({ error: 'Value not found' }, { status: 404 })
    if (await attributeValueLabelTaken(owner.attributeId, label, id)) {
      return NextResponse.json({ error: `That attribute already has a value called "${label}".` }, { status: 409 })
    }
    slug = await ensureUniqueValueSlug(owner.attributeId, slugify(label) || 'value', id)
  }

  await updateAttributeValue(id, { ...parsed.data, ...(label !== undefined ? { label, slug } : {}) })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteAttributeValue(id)
  return NextResponse.json({ ok: true })
}
