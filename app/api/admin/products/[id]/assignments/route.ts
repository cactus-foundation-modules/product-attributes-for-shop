import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import {
  getProductAssignments,
  setProductValueIdsByAssignment,
  clearImportedValuesForProduct,
} from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { getProductAttributes, setProductAttributes } from '@/modules/product-attributes-for-shop/lib/db/membership'
import { listVariantsForProduct } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'

// Everything the product editor's attributes panel needs in one round trip: the
// attribute vocabulary, this product's set (which attributes it uses, with their
// two flags), the product-level value assignments, and its variants (empty when
// shop-variations is not installed). Per-variant values are not here - they live
// on the Variations tab column and save themselves.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  const [attributes, assignments, membership, variants] = await Promise.all([
    listAttributes(),
    getProductAssignments(id),
    getProductAttributes(id),
    listVariantsForProduct(id),
  ])
  return NextResponse.json({ attributes, assignments, membership, variants })
}

// The set is submitted in display order, each helping carrying the values ticked
// under it. Existing helpings send the id they already have; a newly added one
// sends none and gets one back.
const PutBody = z.object({
  membership: z
    .array(
      z.object({
        id: z.string().nullable().optional(),
        attributeId: z.string(),
        // Null (or blank) means "call this one whatever the attribute is
        // called", which only one helping of an attribute may do.
        nameOverride: z.string().max(120).nullable().optional(),
        useForVariations: z.boolean(),
        showInFilters: z.boolean(),
        // Product-level ticks for this helping. Ignored when it is used for
        // variations - the value then belongs to each variant, not the product.
        values: z.array(z.string()).max(500).default([]),
      }),
    )
    .max(200),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PutBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { membership } = parsed.data

  // Two helpings of one attribute must go by different names, and only one of
  // them may go by the attribute's own. Enforced here as well as in the editor
  // because the database constraint would otherwise fail the save with an error
  // no shop owner could act on.
  const seen = new Set<string>()
  for (const m of membership) {
    const key = `${m.attributeId}|${(m.nameOverride ?? '').trim().toLowerCase()}`
    if (seen.has(key)) {
      return NextResponse.json(
        { error: 'This product uses the same attribute twice under one name. Give each helping a name of its own.' },
        { status: 409 },
      )
    }
    seen.add(key)
  }

  // An attribute used more than once may now be a variations column more than
  // once too: each helping is its own column, keyed by assignment, so a table can
  // have a main finish and an edge finish off one Finish vocabulary. The name
  // check above is what keeps the two columns (and their CSV headers) apart, so
  // there is nothing further to refuse here.

  // Save the set, then clear assignments for any attribute dropped from it, so a
  // removed attribute stops dragging the product into its filter. Only genuinely
  // gone attributes count - one whose second helping was removed is still on the
  // product and keeps its values.
  const before = await getProductAttributes(id)
  const assignmentIds = await setProductAttributes(id, membership)
  const keptAttributeIds = new Set(membership.map((m) => m.attributeId))
  const removed = [...new Set(before.map((m) => m.attributeId))].filter((a) => !keptAttributeIds.has(a))
  if (removed.length > 0) await clearImportedValuesForProduct(id, removed)

  const byAssignment: Record<string, string[]> = {}
  membership.forEach((m, index) => {
    const assignmentId = assignmentIds[index]
    // A helping naming a since-deleted attribute writes no row and gets no id.
    if (!assignmentId || m.useForVariations) return
    byAssignment[assignmentId] = m.values
  })
  await setProductValueIdsByAssignment(id, byAssignment)

  return NextResponse.json({ ok: true })
}
