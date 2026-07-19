import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  updateAttribute,
  deleteAttribute,
  getAttribute,
  attributeNameTaken,
  ensureUniqueAttributeSlug,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { getAttributeGroup } from '@/modules/product-attributes-for-shop/lib/db/groups'
import { refileAttributeSwatches } from '@/modules/product-attributes-for-shop/lib/media-folder'

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  controlType: z.enum(['CHECKBOX', 'SWATCH', 'DROPDOWN', 'IMAGE']).optional(),
  position: z.number().int().optional(),
  showInFilters: z.boolean().optional(),
  // null is the ungrouped pile, not "leave it alone" - `.optional()` covers that.
  groupId: z.string().min(1).nullable().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const name = parsed.data.name?.trim()
  let slug: string | undefined
  if (name !== undefined) {
    if (!name) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const attribute = await getAttribute(id)
    if (!attribute) return NextResponse.json({ error: 'Attribute not found' }, { status: 404 })
    if (await attributeNameTaken(name, id)) {
      return NextResponse.json({ error: `There is already an attribute called "${name}".` }, { status: 409 })
    }
    // The slug is the filter's query key, so a rename re-slugs it. Any shopper's
    // bookmarked filter URL stops matching - acceptable, and the alternative
    // (a slug drifting from its label forever) reads worse in the address bar.
    slug = await ensureUniqueAttributeSlug(slugify(name) || 'attribute', id)
  }

  const groupId = parsed.data.groupId
  if (groupId) {
    if (!(await getAttributeGroup(groupId))) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }
  }

  await updateAttribute(id, { ...parsed.data, ...(name !== undefined ? { name, slug } : {}) })

  // Both the group and the attribute's own name are folder segments for its
  // picture swatches, so either changing moves the pictures. Runs after the
  // update so the re-filer reads the destination, and unconditionally on a
  // rename because that has quietly stranded pictures since day one.
  if (groupId !== undefined || name !== undefined) await refileAttributeSwatches(id)

  return NextResponse.json({ ok: true })
}

// Deleting an attribute cascades its values, which in turn cascades every
// product/variant assignment of those values.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteAttribute(id)
  return NextResponse.json({ ok: true })
}
