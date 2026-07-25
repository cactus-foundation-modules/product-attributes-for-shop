import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import {
  getProductAssignments,
  setProductValueIdsByAssignment,
  clearImportedValuesForProduct,
} from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { getProductAttributes, setProductAttributes } from '@/modules/product-attributes-for-shop/lib/db/membership'
import { listProductSpecSections, setProductSpecSections } from '@/modules/product-attributes-for-shop/lib/db/spec-sections'
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
  const [attributes, assignments, membership, variants, sections] = await Promise.all([
    listAttributes(),
    getProductAssignments(id),
    getProductAttributes(id),
    listVariantsForProduct(id),
    listProductSpecSections(id),
  ])
  return NextResponse.json({ attributes, assignments, membership, variants, sections })
}

// The set is submitted in display order, each helping carrying the values ticked
// under it. Existing helpings send the id they already have; a newly added one
// sends none and gets one back.
const PutBody = z.object({
  // The product's Specification sections, in display order. Each carries a `key`
  // the editor also uses on a helping's `specSectionKey`, so a helping can point
  // at a section that has no saved id yet. A kept section sends its id too.
  sections: z
    .array(
      z.object({
        id: z.string().nullable().optional(),
        key: z.string(),
        name: z.string().max(120),
        position: z.number().int().min(0),
      }),
    )
    .max(100)
    .default([]),
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
        // Specification-tab placement. `specSectionKey` names one of the sections
        // above by its `key` (null = the unsectioned run); it is resolved to a
        // saved section id once the sections are written.
        showInSpec: z.boolean().default(false),
        specSectionKey: z.string().nullable().default(null),
        specPosition: z.number().int().min(0).default(0),
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
  const { membership, sections } = parsed.data

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

  // Sections first, so their saved ids exist before a helping's spec_section_id
  // is written against one (the FK would otherwise refuse it). The returned map
  // turns the editor's section `key` into that saved id; a helping naming a
  // section that was dropped in the same save resolves to null and lands in the
  // unsectioned run. Not one atomic transaction with the writes below, matching
  // this route's existing set-then-values sequence.
  const sectionIdByKey = await setProductSpecSections(id, sections)

  // Save the set, then clear assignments for any attribute dropped from it, so a
  // removed attribute stops dragging the product into its filter. Only genuinely
  // gone attributes count - one whose second helping was removed is still on the
  // product and keeps its values.
  const before = await getProductAttributes(id)
  const assignmentIds = await setProductAttributes(
    id,
    membership.map((m) => ({
      id: m.id,
      attributeId: m.attributeId,
      nameOverride: m.nameOverride,
      useForVariations: m.useForVariations,
      showInFilters: m.showInFilters,
      // A per-variant helping may show on the spec too: it has no single value on
      // the product, so the public view draws its variants' distinct values (see
      // spec-view.ts). The flag is trusted for either kind of helping now.
      showInSpec: m.showInSpec,
      specSectionId: m.specSectionKey ? sectionIdByKey.get(m.specSectionKey) ?? null : null,
      specPosition: m.specPosition,
    })),
  )
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
