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
  listSwatchFileInfo,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { getAttributeGroup } from '@/modules/product-attributes-for-shop/lib/db/groups'
import { countProductsPerValue } from '@/modules/product-attributes-for-shop/lib/db/value-usage'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'

export async function GET() {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const attributes = await listAttributes()

  // All three renditions of every picture swatch, weighed in one go, so the
  // screen can say what each thumbnail costs without a request per picture. Hex
  // colours have no file behind them and are filtered out by the same validator
  // that decides whether the column holds a picture at all.
  const swatchFiles = await listSwatchFileInfo(
    attributes
      .flatMap((a) => a.values.flatMap((v) => [v.swatch, v.swatchSmall ?? null, v.swatchTiny ?? null]))
      .filter((url): url is string => !!url && isImageSwatch(url)),
  )
  // How many products hang off each value, counted once for the whole screen so
  // every chip can print its own number without a request apiece.
  const valueProductCounts = await countProductsPerValue()
  return NextResponse.json({ attributes, swatchFiles, valueProductCounts })
}

const PostBody = z.object({
  name: z.string().min(1).max(80),
  controlType: z.enum(['CHECKBOX', 'SWATCH', 'DROPDOWN', 'IMAGE']).default('CHECKBOX'),
  groupId: z.string().min(1).nullable().optional(),
})

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = PostBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const name = parsed.data.name.trim()
  if (!name) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const groupId = parsed.data.groupId ?? null
  if (groupId && !(await getAttributeGroup(groupId))) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }

  // Names only have to be unique within a group, so the group has to be resolved
  // before the clash can be judged.
  if (await attributeNameTaken(name, groupId, '')) {
    return NextResponse.json(
      { error: groupId
        ? `There is already an attribute called "${name}" in this group.`
        : `There is already an ungrouped attribute called "${name}".` },
      { status: 409 },
    )
  }

  const slug = await ensureUniqueAttributeSlug(slugify(name) || 'attribute')
  const created = await createAttribute({
    name,
    slug,
    controlType: parsed.data.controlType,
    position: await nextAttributePosition(),
    groupId,
  })
  return NextResponse.json({ id: created.id, slug })
}
