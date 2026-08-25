import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  getAttribute,
  createAttributeValue,
  getAttributeValue,
  updateAttributeValue,
  findAttributeValueByLabel,
  findAttributeValueBySlug,
  ensureUniqueValueSlug,
  nextValuePosition,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { fileSwatchImage } from '@/modules/product-attributes-for-shop/lib/media-folder'
import { generateSwatchCopies } from '@/modules/product-attributes-for-shop/lib/swatch-renditions'
import { isImageSwatch, isValidSwatch, SWATCH_MAX_LENGTH, SWATCH_SIZE_MAX_LENGTH } from '@/modules/product-attributes-for-shop/lib/types'

const PostBody = z.object({
  label: z.string().min(1).max(80),
  // Explicit slug, e.g. "black-mfc" for a second "Black". Optional: left off,
  // the slug is made from the label ("black", then "black-2" for a duplicate).
  // Normalised through slugify either way, so whatever arrives ends up in the
  // platform's lowercase-and-hyphens shape.
  slug: z.string().min(1).max(100).optional(),
  // A hex colour or a picture url - see isValidSwatch. Anything else is refused
  // rather than stored and rendered, since this string ends up in an <img src>.
  swatch: z.string().max(SWATCH_MAX_LENGTH).refine(isValidSwatch).nullable().optional(),
  // The picture's real-world size, as typed ("20cm", "200mm", a bare "20"). Left
  // off by every caller but the attributes screen's picture-swatch form, and
  // optional there too - a swatch with no size given simply draws uncalibrated.
  swatchSize: z.string().max(SWATCH_SIZE_MAX_LENGTH).nullable().optional(),
  // Set by the inline boxes on a product's Attributes and Variations tabs, where
  // a label that already exists means "use that one". The attributes screen
  // leaves it off: there, typing "Black" a second time makes a second Black with
  // its own slug - duplicates are legal, told apart by slug.
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

  // Duplicate labels are deliberately allowed: a second "Black" with its own
  // slug and swatch (black-mfc beside black-fabric) is the point, not a mistake.
  // The slug is what keeps the two apart everywhere that matters.
  const requestedSlug = parsed.data.slug !== undefined ? slugify(parsed.data.slug) : ''
  if (parsed.data.slug !== undefined && !requestedSlug) {
    return NextResponse.json({ error: 'That slug has nothing usable in it - letters and numbers, please.' }, { status: 400 })
  }

  if (parsed.data.reuseExisting) {
    // A caller that knows the slug means that exact value; a bare label reuses
    // the first match as it always did.
    const existing = requestedSlug
      ? await findAttributeValueBySlug(id, requestedSlug)
      : await findAttributeValueByLabel(id, label)
    if (existing) return NextResponse.json({ value: existing, reused: true })
  }

  const slug = await ensureUniqueValueSlug(id, requestedSlug || slugify(label) || 'value')
  const swatch = parsed.data.swatch ?? null
  // A blank box is "no size", not a size of "" - see the PATCH route, which
  // normalises the same way so an edit and an add cannot disagree.
  const swatchSize = parsed.data.swatchSize?.trim() || null
  const position = await nextValuePosition(id)
  const created = await createAttributeValue({ attributeId: id, label, slug, swatch, swatchSize, position })

  // Filing a picture can rewrite its url (the library keys blobs by folder), so
  // the row is re-read rather than echoing the url that was sent in - otherwise
  // the editor would show the pre-move url and 404 until the next reload.
  let stored = swatch
  let storedSmall: string | null = null
  let storedTiny: string | null = null
  if (swatch && isImageSwatch(swatch)) {
    await fileSwatchImage(id, created.id, swatch)
    stored = (await getAttributeValue(created.id))?.swatch ?? swatch
    // The shrunk copies the storefront prefers - 400px for the product page,
    // 128px for listings - made from the FILED url so they land in the
    // attribute's own folder. Null (an external host, an already-small original)
    // just means renderers keep using the next size up.
    const made = stored ? await generateSwatchCopies(stored) : { small: null, tiny: null }
    storedSmall = made.small
    storedTiny = made.tiny
    if (storedSmall || storedTiny) await updateAttributeValue(created.id, { swatchSmall: storedSmall, swatchTiny: storedTiny })
  }

  return NextResponse.json({
    id: created.id,
    slug,
    value: { id: created.id, attributeId: id, label, slug, swatch: stored, swatchSmall: storedSmall, swatchTiny: storedTiny, swatchSize, position },
    reused: false,
  })
}
