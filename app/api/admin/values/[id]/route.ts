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
import { syncSourcedOptionValues } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
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
  // the one that was sent in - and it is the stored one that gets copied out to
  // the variation options below, not the one that came in.
  let swatch = parsed.data.swatch
  let filed = false
  if (swatch && isImageSwatch(swatch)) {
    const owner = await getAttributeValueOwner(id)
    if (owner) {
      await fileSwatchImage(owner.attributeId, id, swatch)
      swatch = (await getAttributeValue(id))?.swatch ?? swatch
      filed = true
    }
  }

  // Carry the edit through to every variation option value built from this
  // attribute value, and re-name the variants composed from it, so one edit here
  // is the whole job rather than the first of however many products use it.
  //
  // A no-op when shop-variations is not installed, which is the usual case for a
  // plain filtered catalogue.
  const propagated = await syncSourcedOptionValues(id, {
    ...(label !== undefined ? { label } : {}),
    ...(parsed.data.swatch !== undefined ? { swatch } : {}),
  })

  return NextResponse.json({
    ok: true,
    ...(filed ? { swatch } : {}),
    ...(propagated.updated > 0 || propagated.blocked.length > 0
      ? {
          optionValuesUpdated: propagated.updated,
          optionValuesBlocked: propagated.blocked,
          variantsRenamed: propagated.variantsRenamed,
        }
      : {}),
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteAttributeValue(id)
  return NextResponse.json({ ok: true })
}
