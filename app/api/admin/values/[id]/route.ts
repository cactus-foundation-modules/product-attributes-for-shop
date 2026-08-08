import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  updateAttributeValue,
  deleteAttributeValue,
  getAttributeValue,
  getAttributeValueOwner,
  ensureUniqueValueSlug,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { fileSwatchImage } from '@/modules/product-attributes-for-shop/lib/media-folder'
import { generateSmallSwatch } from '@/modules/product-attributes-for-shop/lib/swatch-small'
import { syncSourcedOptionValues } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { isImageSwatch, isValidSwatch, SWATCH_MAX_LENGTH, SWATCH_SIZE_MAX_LENGTH } from '@/modules/product-attributes-for-shop/lib/types'

const PatchBody = z.object({
  label: z.string().min(1).max(80).optional(),
  // A new slug for the value, e.g. "black-mfc". Renaming a LABEL no longer
  // touches the slug - it is the value's stable identity, and every sheet cell
  // and variation copy resolves by it - so moving it is its own deliberate edit.
  slug: z.string().min(1).max(100).optional(),
  // A hex colour or a picture url - see isValidSwatch. Anything else is refused
  // rather than stored and rendered, since this string ends up in an <img src>.
  swatch: z.string().max(SWATCH_MAX_LENGTH).refine(isValidSwatch).nullable().optional(),
  // The picture's real-world size, as typed. Editable after the value was made,
  // which is the point of it being here rather than only on the add form: the
  // figure often arrives from the supplier after the swatch photograph does.
  // Null clears it; the empty string is normalised to null below so a cleared box
  // and a never-filled one are the same thing to everything downstream.
  swatchSize: z.string().max(SWATCH_SIZE_MAX_LENGTH).nullable().optional(),
  position: z.number().int().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // A label rename is just a rename now: duplicates are legal (two "Black"s,
  // told apart by slug), and the slug deliberately stays put so sheets and
  // variation copies keep resolving the same value. Changing the slug is its
  // own explicit edit below.
  const label = parsed.data.label?.trim()
  if (label !== undefined && !label) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  let slug: string | undefined
  if (parsed.data.slug !== undefined) {
    const requested = slugify(parsed.data.slug)
    if (!requested) {
      return NextResponse.json({ error: 'That slug has nothing usable in it - letters and numbers, please.' }, { status: 400 })
    }
    const owner = await getAttributeValueOwner(id)
    if (!owner) return NextResponse.json({ error: 'Value not found' }, { status: 404 })
    slug = await ensureUniqueValueSlug(owner.attributeId, requested, id)
  }

  // A blank box means "no size", not a size of "". Normalised here so the column
  // holds one representation of "not given" rather than two.
  const swatchSize =
    parsed.data.swatchSize === undefined ? undefined : parsed.data.swatchSize?.trim() || null

  // Read before the write: deciding whether the small rendition below needs
  // remaking means knowing what the swatch WAS.
  const previous = parsed.data.swatch !== undefined ? await getAttributeValue(id) : null

  await updateAttributeValue(id, {
    ...parsed.data,
    ...(swatchSize !== undefined ? { swatchSize } : {}),
    ...(label !== undefined ? { label } : {}),
    // The normalised, deduped spelling - never the raw request string.
    ...(slug !== undefined ? { slug } : {}),
  })

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

  // The small rendition lives and dies with the picture it was made from: a new
  // picture gets a fresh one, a hex colour or a cleared swatch gets none, and a
  // re-pick of the same picture keeps the one it has rather than minting a
  // duplicate file per save. Made from the FILED url so it lands in the
  // attribute's own folder.
  let swatchSmall: string | null | undefined
  if (parsed.data.swatch !== undefined) {
    const unchanged = previous && previous.swatch === (swatch ?? null)
    swatchSmall = unchanged
      ? previous.swatchSmall ?? null
      : swatch && isImageSwatch(swatch) ? await generateSmallSwatch(swatch) : null
    if ((previous?.swatchSmall ?? null) !== swatchSmall) {
      await updateAttributeValue(id, { swatchSmall })
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
    ...(swatchSmall !== undefined ? { swatchSmall } : {}),
    ...(slug !== undefined ? { slug } : {}),
  })

  return NextResponse.json({
    ok: true,
    ...(slug !== undefined ? { slug } : {}),
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
