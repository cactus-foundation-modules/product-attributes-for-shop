import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  updateAttributeValue,
  deleteAttributeValue,
  getAttributeValue,
  getAttributeValueOwner,
  attributeValueLabelTaken,
  ensureUniqueValueSlug,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { fileSwatchImage } from '@/modules/product-attributes-for-shop/lib/media-folder'
import { isImageSwatch, isValidSwatch, SWATCH_MAX_LENGTH } from '@/modules/product-attributes-for-shop/lib/types'

const PatchBody = z.object({
  label: z.string().min(1).max(80).optional(),
  // A hex colour or a picture url - see isValidSwatch. Anything else is refused
  // rather than stored and rendered, since this string ends up in an <img src>.
  swatch: z.string().max(SWATCH_MAX_LENGTH).refine(isValidSwatch).nullable().optional(),
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

  // File a newly-picked picture in the attribute's folder. Filing can rewrite the
  // url, so the stored value is handed back for the editor to show rather than
  // the one that was sent in.
  const swatch = parsed.data.swatch
  if (swatch && isImageSwatch(swatch)) {
    const owner = await getAttributeValueOwner(id)
    if (owner) {
      await fileSwatchImage(owner.attributeId, id, swatch)
      return NextResponse.json({ ok: true, swatch: (await getAttributeValue(id))?.swatch ?? swatch })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteAttributeValue(id)
  return NextResponse.json({ ok: true })
}
