import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { slugify } from '@/modules/shop/lib/slug'
import {
  getAttributeGroup,
  updateAttributeGroup,
  deleteAttributeGroup,
  attributeGroupNameTaken,
  ensureUniqueGroupSlug,
  listAttributeIdsInGroup,
} from '@/modules/product-attributes-for-shop/lib/db/groups'
import { refileAttributeSwatches, refileGroupSwatches } from '@/modules/product-attributes-for-shop/lib/media-folder'

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  position: z.number().int().optional(),
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
    const group = await getAttributeGroup(id)
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    if (await attributeGroupNameTaken(name, id)) {
      return NextResponse.json({ error: `There is already a group called "${name}".` }, { status: 409 })
    }
    slug = await ensureUniqueGroupSlug(slugify(name) || 'group', id)
  }

  await updateAttributeGroup(id, { ...parsed.data, ...(name !== undefined ? { name, slug } : {}) })

  // The group's name is a folder segment for every attribute inside it, so a
  // rename takes all their picture swatches with it. Deliberately after the
  // update: the re-filer reads the new name from the row.
  if (name !== undefined) await refileGroupSwatches(id)

  return NextResponse.json({ ok: true })
}

// Deleting a group keeps its attributes - the foreign key sets their group_id to
// null - so this is a demotion to the ungrouped pile rather than a delete of
// anything a shopper would notice.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  // Read the membership first: once the row is gone, group_id is null and there
  // is nothing left to tell us whose pictures need moving back out of the folder.
  const attributeIds = await listAttributeIdsInGroup(id)
  await deleteAttributeGroup(id)
  for (const attributeId of attributeIds) {
    await refileAttributeSwatches(attributeId)
  }

  return NextResponse.json({ ok: true })
}
