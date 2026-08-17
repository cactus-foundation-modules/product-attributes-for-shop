import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { slugify } from '@/modules/shop/lib/slug'
import type { PatProductAttribute, PatVariationColumn } from '@/modules/product-attributes-for-shop/lib/types'

// The attribute "set" for a product: which attributes it uses and the two
// per-(product, attribute) flags. Everything here reads/writes pat_product_attributes.

// The product's chosen attributes with their flags, in the order the editor
// shows them. A product may hold the same attribute more than once, so this is a
// list of helpings, not a list of attributes.
export async function getProductAttributes(productId: string): Promise<PatProductAttribute[]> {
  const rows = await prisma.$queryRaw<{
    id: string; attribute_id: string; name_override: string | null; position: number
    use_for_variations: boolean; show_in_filters: boolean
    show_in_spec: boolean; spec_section_id: string | null; spec_position: number
  }[]>`
    SELECT ppa."id", ppa."attribute_id", ppa."name_override", ppa."position",
           ppa."use_for_variations", ppa."show_in_filters",
           ppa."show_in_spec", ppa."spec_section_id", ppa."spec_position"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    WHERE ppa."product_id" = ${productId}
    ORDER BY ppa."position" ASC, a."position" ASC, a."created_at" ASC
  `
  return rows.map((r) => ({
    id: r.id,
    attributeId: r.attribute_id,
    nameOverride: r.name_override,
    position: r.position,
    useForVariations: r.use_for_variations,
    showInFilters: r.show_in_filters,
    showInSpec: r.show_in_spec,
    specSectionId: r.spec_section_id,
    specPosition: r.spec_position,
  }))
}

// One helping as the editor submits it: an existing row keeps its id, a
// newly-added one has none yet.
export type PatProductAttributeInput = {
  id?: string | null
  attributeId: string
  nameOverride?: string | null
  useForVariations: boolean
  showInFilters: boolean
  // The Specification-tab placement, resolved by the caller: whether the helping
  // shows on the page, which of the product's sections it sits under (the section
  // must already exist - the route creates sections first and maps the editor's
  // key to the saved id), and its order within that section.
  showInSpec: boolean
  specSectionId: string | null
  specPosition: number
}

/**
 * Replaces a product's whole set in one go, returning the assignment id each
 * submitted helping ended up with (by its index in `rows`), so the caller can
 * save the ticked values against them.
 *
 * Helpings the owner kept are updated in place rather than deleted and re-made:
 * their id is what the value rows hang off, and recreating it would cascade
 * every tick away mid-save.
 *
 * This is also where the sheet's attach blocks are kept honest. An attribute the
 * owner USED to have as a variation column and no longer does is recorded in
 * `pat_variation_attach_blocks`, so a plain heading naming it cannot put it back
 * on the next Pull; an attribute they have just added as one clears its block,
 * because that is the owner saying yes rather than the sheet saying it for them.
 * Both writes are inside the same transaction as the save itself - a block that
 * outlived a rolled-back save would silently refuse an attach for ever after.
 */
export async function setProductAttributes(
  productId: string,
  rows: PatProductAttributeInput[],
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    // What the product carries BEFORE the save, so the two sets can be compared
    // once the writes are done.
    const before = await tx.$queryRaw<{ attribute_id: string }[]>`
      SELECT DISTINCT "attribute_id" FROM "pat_product_attributes"
      WHERE "product_id" = ${productId} AND "use_for_variations" = true
    `
    const variationBefore = new Set(before.map((r) => r.attribute_id))
    const variationAfter = new Set(rows.filter((r) => r.useForVariations).map((r) => r.attributeId))

    const keptIds = rows.map((r) => r.id).filter((id): id is string => !!id)
    if (keptIds.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "pat_product_attributes"
        WHERE "product_id" = ${productId} AND "id" NOT IN (${Prisma.join(keptIds)})
      `
    } else {
      await tx.$executeRaw`DELETE FROM "pat_product_attributes" WHERE "product_id" = ${productId}`
    }

    const ids: string[] = []
    for (const [position, row] of rows.entries()) {
      const name = row.nameOverride?.trim() || null
      if (row.id) {
        await tx.$executeRaw`
          UPDATE "pat_product_attributes"
          SET "name_override" = ${name}, "position" = ${position},
              "use_for_variations" = ${row.useForVariations}, "show_in_filters" = ${row.showInFilters},
              "show_in_spec" = ${row.showInSpec}, "spec_section_id" = ${row.specSectionId},
              "spec_position" = ${row.specPosition}
          WHERE "id" = ${row.id} AND "product_id" = ${productId}
        `
        ids.push(row.id)
        continue
      }
      // The join to pat_attributes drops a helping naming an attribute that has
      // since been deleted, rather than erroring the whole save.
      const created = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "pat_product_attributes"
          ("product_id", "attribute_id", "name_override", "position", "use_for_variations", "show_in_filters",
           "show_in_spec", "spec_section_id", "spec_position")
        SELECT ${productId}, a."id", ${name}, ${position}, ${row.useForVariations}, ${row.showInFilters},
               ${row.showInSpec}, ${row.specSectionId}, ${row.specPosition}
        FROM "pat_attributes" a WHERE a."id" = ${row.attributeId}
        RETURNING "id"
      `
      ids.push(created[0]?.id ?? '')
    }

    // Removed from variations: block it. Added to variations: unblock it.
    // Anything in neither set is untouched, so an attribute the owner has never
    // had as a variation column keeps whatever block it already carried.
    const removed = [...variationBefore].filter((id) => !variationAfter.has(id))
    const added = [...variationAfter].filter((id) => !variationBefore.has(id))
    if (removed.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "pat_variation_attach_blocks" ("product_id", "attribute_id")
        SELECT ${productId}, a."id" FROM "pat_attributes" a
        WHERE a."id" IN (${Prisma.join(removed)})
        ON CONFLICT ("product_id", "attribute_id") DO NOTHING
      `
    }
    if (added.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "pat_variation_attach_blocks"
        WHERE "product_id" = ${productId} AND "attribute_id" IN (${Prisma.join(added)})
      `
    }
    return ids
  })
}

// Is this attribute blocked from being attached to this product by a column
// heading? True once the owner has taken it off the product's variations by
// hand, until they put it back the same way.
export async function isVariationAttachBlocked(productId: string, attributeId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "pat_variation_attach_blocks"
    WHERE "product_id" = ${productId} AND "attribute_id" = ${attributeId}
    LIMIT 1
  `
  return rows.length > 0
}

// Every blocked (product, attribute) pair among the ones asked about, as
// "productId|attributeId" keys. The batched form, so an import that walks a
// whole catalogue asks once rather than once per row.
export async function listVariationAttachBlocks(productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set()
  const rows = await prisma.$queryRaw<{ product_id: string; attribute_id: string }[]>`
    SELECT "product_id", "attribute_id" FROM "pat_variation_attach_blocks"
    WHERE "product_id" IN (${Prisma.join(productIds)})
  `
  return new Set(rows.map((r) => `${r.product_id}|${r.attribute_id}`))
}

// Upserts a single membership row without disturbing the rest of the set, and
// hands back the helping's id so the caller can file per-variant values against
// it. Used by the "Copy from variations" import so it can mark the attributes it
// touched as used-for-variations without clearing anything the admin set by hand.
// Imported helpings never carry a name of their own, so the un-named row for the
// attribute is the one this matches - a renamed second helping is left alone.
export async function upsertProductAttribute(
  productId: string,
  row: { attributeId: string; useForVariations: boolean; showInFilters: boolean },
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "pat_product_attributes"
      ("product_id", "attribute_id", "name_override", "use_for_variations", "show_in_filters")
    SELECT ${productId}, a."id", ${null}, ${row.useForVariations}, ${row.showInFilters}
    FROM "pat_attributes" a WHERE a."id" = ${row.attributeId}
    ON CONFLICT ("product_id", "attribute_id", "name_override")
    DO UPDATE SET "use_for_variations" = EXCLUDED."use_for_variations"
    RETURNING "id"
  `
  return rows[0]?.id ?? null
}

// Get-or-make a PRODUCT-LEVEL (non use-for-variations) helping for an attribute,
// for the Products-tab auto-attach: a value typed into a column that names an
// attribute the product does not yet carry at product level attaches it. The twin
// of upsertProductAttribute's use for the Variations tab, but with one crucial
// difference - it must never flip an existing helping's use_for_variations. The
// un-named slot for a (product, attribute) is unique, so a product already using
// the attribute FOR VARIATIONS owns that slot; hijacking it (as a plain upsert's
// DO UPDATE would) would tear the attribute off every variant. So: try to create a
// product-level un-named helping, DO NOTHING on conflict, and otherwise reuse only
// a helping that is ALREADY product-level. When the only helping is a variation
// one, return null and the caller leaves the product alone.
export async function upsertProductLevelAttribute(
  productId: string,
  attributeId: string,
): Promise<string | null> {
  const inserted = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "pat_product_attributes"
      ("product_id", "attribute_id", "name_override", "use_for_variations", "show_in_filters")
    SELECT ${productId}, a."id", ${null}, false, false
    FROM "pat_attributes" a WHERE a."id" = ${attributeId}
    ON CONFLICT ("product_id", "attribute_id", "name_override") DO NOTHING
    RETURNING "id"
  `
  if (inserted[0]) return inserted[0].id
  // Conflict (the un-named slot is taken) or no such attribute. Reuse a helping
  // only when it is already product-level; a variation helping is left untouched.
  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_product_attributes"
    WHERE "product_id" = ${productId} AND "attribute_id" = ${attributeId} AND "use_for_variations" = false
    ORDER BY "position" ASC LIMIT 1
  `
  return existing[0]?.id ?? null
}

// Get-or-make a VARIATION (use-for-variations) helping for an attribute, for the
// Variations-tab auto-attach: a column headed with an attribute's name, with
// values under it, attaches that attribute to the product as a variation column.
// The exact twin of upsertProductLevelAttribute above, and for exactly the same
// reason - it must never flip an existing helping's use_for_variations.
//
// That flip is what took auto-attach away the first time round. The old code
// upserted with DO UPDATE SET use_for_variations = true, so a heading naming an
// attribute the owner had set up as ordinary product information turned it into a
// per-variant column on the spot, across twenty-odd live products. So: try to
// create an un-named variation helping, DO NOTHING on conflict, and otherwise
// reuse only a helping that is ALREADY use-for-variations. When the un-named slot
// is held by a product-level helping, hand back null and leave the product alone -
// carrying one attribute both ways is a decision for the Attributes tab.
export async function upsertVariationAttribute(
  productId: string,
  attributeId: string,
): Promise<string | null> {
  // The owner has taken this attribute off this product before, so a column
  // heading does not get to put it back. Checked in the INSERT itself rather
  // than beforehand, so a save removing it cannot slip between the two.
  const inserted = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "pat_product_attributes"
      ("product_id", "attribute_id", "name_override", "use_for_variations", "show_in_filters")
    SELECT ${productId}, a."id", ${null}, true, false
    FROM "pat_attributes" a
    WHERE a."id" = ${attributeId}
      AND NOT EXISTS (
        SELECT 1 FROM "pat_variation_attach_blocks" b
        WHERE b."product_id" = ${productId} AND b."attribute_id" = ${attributeId}
      )
    ON CONFLICT ("product_id", "attribute_id", "name_override") DO NOTHING
    RETURNING "id"
  `
  if (inserted[0]) return inserted[0].id
  // Conflict (the un-named slot is taken) or no such attribute. Reuse a helping
  // only when it is already a variation one; a product-level helping is left
  // exactly as the owner set it up.
  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_product_attributes"
    WHERE "product_id" = ${productId} AND "attribute_id" = ${attributeId} AND "use_for_variations" = true
    ORDER BY "position" ASC LIMIT 1
  `
  return existing[0]?.id ?? null
}

// Every attribute's id and name, for matching a sheet column heading back to the
// attribute it names. Used by the Variations import to let a value typed into a
// column for an attribute a product does not yet use auto-attach that attribute
// to the product (see the variant field provider). Names only, no values - the
// caller resolves those against the attribute it matches.
export async function listAllAttributes(): Promise<{ id: string; name: string }[]> {
  return prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "pat_attributes" ORDER BY "position" ASC
  `
}

// The product's product-level (NOT use-for-variations) helpings, in display order
// - the columns the Products tab of the Google Sheet shows and carries. The twin
// of listVariationColumns for the parent product's own ticks rather than a
// variant's. No value vocabulary is gathered: the sheet carries whatever labels
// are ticked, and an import resolves each against the attribute it names.
export async function listProductLevelColumns(
  productId: string,
): Promise<{ assignmentId: string; attributeId: string; name: string; position: number }[]> {
  const rows = await prisma.$queryRaw<
    { assignment_id: string; attribute_id: string; name: string; position: number }[]
  >`
    SELECT ppa."id" AS "assignment_id", a."id" AS "attribute_id",
           COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS "name",
           ppa."position"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    WHERE ppa."product_id" = ${productId} AND ppa."use_for_variations" = false
    ORDER BY ppa."position" ASC, a."position" ASC, a."created_at" ASC
  `
  return rows.map((r) => ({ assignmentId: r.assignment_id, attributeId: r.attribute_id, name: r.name, position: r.position }))
}

// The same, for MANY products in one query, grouped by product and in the same
// display order within each. A caller working over a whole catalogue - the
// Google-Sheet check, which asks "would this row change?" for every product -
// otherwise makes one round trip per product, and on a catalogue of a few hundred
// that is the entire cost of the pass. Measured at 204ms per product from a
// machine a hop away from the database: 445 products, ninety seconds, all of it
// waiting. The provider preloads through this in beginImport.
export async function listProductLevelColumnsForProducts(
  productIds: string[],
): Promise<Map<string, { assignmentId: string; attributeId: string; name: string; position: number }[]>> {
  const map = new Map<string, { assignmentId: string; attributeId: string; name: string; position: number }[]>()
  const unique = [...new Set(productIds)].filter(Boolean)
  if (unique.length === 0) return map
  const rows = await prisma.$queryRaw<
    { product_id: string; assignment_id: string; attribute_id: string; name: string; position: number }[]
  >`
    SELECT ppa."product_id", ppa."id" AS "assignment_id", a."id" AS "attribute_id",
           COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS "name",
           ppa."position"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    WHERE ppa."product_id" IN (${Prisma.join(unique)}) AND ppa."use_for_variations" = false
    ORDER BY ppa."position" ASC, a."position" ASC, a."created_at" ASC
  `
  for (const r of rows) {
    const list = map.get(r.product_id) ?? []
    list.push({ assignmentId: r.assignment_id, attributeId: r.attribute_id, name: r.name, position: r.position })
    map.set(r.product_id, list)
  }
  return map
}

// The product's use-for-variations helpings with their selectable values, in
// display order - the columns the Variations tab shows and the CSV carries.
//
// One column per helping, not per attribute: a product that puts Finish up twice
// gets a "Main finish" column and an "Edge finish" one, each offering the same
// values and each remembered separately per variant. The heading is the helping's
// own name where it has one, which is also the CSV header, so the two columns
// stay tellable apart in a sheet - the editor and the API both refuse to save two
// helpings of an attribute under one name for exactly that reason.
export async function listVariationColumns(productId: string): Promise<PatVariationColumn[]> {
  const rows = await prisma.$queryRaw<
    {
      assignment_id: string; attribute_id: string; name: string; position: number
      value_id: string | null; label: string | null; swatch: string | null
    }[]
  >`
    SELECT ppa."id" AS "assignment_id", a."id" AS "attribute_id",
           COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS "name",
           ppa."position",
           av."id" AS "value_id", av."label", av."swatch"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    LEFT JOIN "pat_attribute_values" av ON av."attribute_id" = a."id"
    WHERE ppa."product_id" = ${productId} AND ppa."use_for_variations" = true
    ORDER BY ppa."position" ASC, a."position" ASC, a."created_at" ASC, av."position" ASC, av."label" ASC
  `
  const byAssignment = new Map<string, PatVariationColumn>()
  for (const r of rows) {
    let col = byAssignment.get(r.assignment_id)
    if (!col) {
      col = {
        assignmentId: r.assignment_id,
        attributeId: r.attribute_id,
        name: r.name,
        position: r.position,
        values: [],
      }
      byAssignment.set(r.assignment_id, col)
    }
    if (r.value_id) col.values.push({ id: r.value_id, label: r.label ?? '', swatch: r.swatch })
  }
  return [...byAssignment.values()]
}

// Current per-variant value for each of the product's use-for-variations
// helpings, keyed by child product id then assignment id. Only variation
// helpings are returned, so a value ticked on the product for an ordinary
// attribute never leaks in here.
//
// Matching is on the row's own assignment, which is what keeps two helpings of
// one attribute apart: "Oak" on the main finish and "Oak" on the edge are two
// rows differing in nothing else.
// The batched twins of listVariationColumns and getVariantAttributeValues:
// every parent's variation columns, and every child's stored values, in one query
// each rather than one per parent.
//
// A caller sweeping a catalogue - the Google Sheet's check, which asks "would
// this row change?" for every variant of every product - paid a round trip per
// parent per provider for these. Measured across 349 variable products, this
// module's share alone was 184 seconds, and none of it was the querying.
export async function listVariationColumnsForProducts(
  productIds: string[],
): Promise<Map<string, PatVariationColumn[]>> {
  const out = new Map<string, PatVariationColumn[]>()
  const unique = [...new Set(productIds)].filter(Boolean)
  if (unique.length === 0) return out
  const rows = await prisma.$queryRaw<
    {
      product_id: string; assignment_id: string; attribute_id: string; name: string; position: number
      value_id: string | null; label: string | null; swatch: string | null
    }[]
  >`
    SELECT ppa."product_id", ppa."id" AS "assignment_id", a."id" AS "attribute_id",
           COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS "name",
           ppa."position",
           av."id" AS "value_id", av."label", av."swatch"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    LEFT JOIN "pat_attribute_values" av ON av."attribute_id" = a."id"
    WHERE ppa."product_id" IN (${Prisma.join(unique)}) AND ppa."use_for_variations" = true
    ORDER BY ppa."position" ASC, a."position" ASC, a."created_at" ASC, av."position" ASC, av."label" ASC
  `
  // Same shape the single-product version builds: one entry per helping, its
  // selectable values gathered underneath it, in display order.
  const byAssignment = new Map<string, PatVariationColumn>()
  for (const r of rows) {
    let col = byAssignment.get(r.assignment_id)
    if (!col) {
      col = { assignmentId: r.assignment_id, attributeId: r.attribute_id, name: r.name, position: r.position, values: [] }
      byAssignment.set(r.assignment_id, col)
      const list = out.get(r.product_id) ?? []
      list.push(col)
      out.set(r.product_id, list)
    }
    if (r.value_id && r.label !== null) col.values.push({ id: r.value_id, label: r.label, swatch: r.swatch })
  }
  return out
}

export async function getVariantAttributeValuesForProducts(
  productIds: string[],
  childProductIds: string[],
): Promise<Record<string, Record<string, { valueId: string; label: string }>>> {
  const result: Record<string, Record<string, { valueId: string; label: string }>> = {}
  const parents = [...new Set(productIds)].filter(Boolean)
  const children = [...new Set(childProductIds)].filter(Boolean)
  if (parents.length === 0 || children.length === 0) return result
  // Parent scoping is kept exactly as the single-product version has it. A child
  // only ever holds values against its own parent's helpings, so it is redundant
  // in practice - but "in practice" is not a reason to widen a query that decides
  // what a variant is currently set to.
  const rows = await prisma.$queryRaw<{ child_id: string; assignment_id: string; value_id: string; label: string }[]>`
    SELECT pv."product_id" AS "child_id", ppa."id" AS "assignment_id", av."id" AS "value_id", av."label"
    FROM "pat_product_values" pv
    JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
    JOIN "pat_product_attributes" ppa
      ON ppa."id" = pv."assignment_id" AND ppa."product_id" IN (${Prisma.join(parents)}) AND ppa."use_for_variations" = true
    WHERE pv."product_id" IN (${Prisma.join(children)})
  `
  for (const r of rows) {
    ;(result[r.child_id] ??= {})[r.assignment_id] = { valueId: r.value_id, label: r.label }
  }
  return result
}

export async function getVariantAttributeValues(
  productId: string,
  childProductIds: string[],
): Promise<Record<string, Record<string, { valueId: string; label: string }>>> {
  const result: Record<string, Record<string, { valueId: string; label: string }>> = {}
  if (childProductIds.length === 0) return result
  const rows = await prisma.$queryRaw<{ child_id: string; assignment_id: string; value_id: string; label: string }[]>`
    SELECT pv."product_id" AS "child_id", ppa."id" AS "assignment_id", av."id" AS "value_id", av."label"
    FROM "pat_product_values" pv
    JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
    JOIN "pat_product_attributes" ppa
      ON ppa."id" = pv."assignment_id" AND ppa."product_id" = ${productId} AND ppa."use_for_variations" = true
    WHERE pv."product_id" IN (${Prisma.join(childProductIds)})
  `
  for (const r of rows) {
    ;(result[r.child_id] ??= {})[r.assignment_id] = { valueId: r.value_id, label: r.label }
  }
  return result
}

// Sets (or clears, with valueId null) one variant child's value for one helping.
// A variation column is single-select per variant, so whatever that helping held
// before is removed first.
//
// The clear-out is scoped to the assignment rather than the attribute, which is
// the whole difference: scoped to the attribute, setting the edge finish would
// take the main finish with it.
export async function setVariantAttributeValue(
  childProductId: string,
  assignmentId: string,
  valueId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "pat_product_values"
      WHERE "product_id" = ${childProductId} AND "assignment_id" = ${assignmentId}
    `
    if (valueId) {
      // The join is the guard: a value belonging to some other attribute than the
      // one this helping names writes no row at all.
      await tx.$executeRaw`
        INSERT INTO "pat_product_values" ("product_id", "value_id", "assignment_id")
        SELECT ${childProductId}, av."id", ppa."id"
        FROM "pat_attribute_values" av
        JOIN "pat_product_attributes" ppa
          ON ppa."id" = ${assignmentId} AND ppa."attribute_id" = av."attribute_id"
        WHERE av."id" = ${valueId}
        ON CONFLICT DO NOTHING
      `
    }
  })
}

// The id of an attribute's value matching a label (case-insensitive), creating it
// if absent. Lets a sheet edit that names a not-yet-existing value round-trip,
// the same way importing options auto-creates values.
// Read-only lookup: the id of an existing value with this label, or null when
// the vocabulary has no such value yet. Unlike ensureAttributeValueByLabel it
// never creates one, so a preview can resolve a known label without mutating.
export async function findAttributeValueByLabel(attributeId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_attribute_values"
    WHERE "attribute_id" = ${attributeId} AND lower("label") = lower(${trimmed}) LIMIT 1
  `
  return existing[0]?.id ?? null
}

export async function ensureAttributeValueByLabel(attributeId: string, label: string): Promise<string | null> {
  const trimmed = label.trim()
  if (!trimmed) return null
  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_attribute_values"
    WHERE "attribute_id" = ${attributeId} AND lower("label") = lower(${trimmed}) LIMIT 1
  `
  if (existing[0]) return existing[0].id

  const base = slugify(trimmed) || 'value'
  let slug = base
  for (let n = 2; ; n++) {
    const clash = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "pat_attribute_values" WHERE "attribute_id" = ${attributeId} AND "slug" = ${slug} LIMIT 1
    `
    if (clash.length === 0) break
    slug = `${base}-${n}`
  }
  const pos = await prisma.$queryRaw<[{ next: number | null }]>`
    SELECT COALESCE(MAX("position"), -1) + 1 AS "next" FROM "pat_attribute_values" WHERE "attribute_id" = ${attributeId}
  `
  const created = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "pat_attribute_values" ("attribute_id", "label", "slug", "swatch", "position")
    VALUES (${attributeId}, ${trimmed}, ${slug}, ${null}, ${Number(pos[0]?.next ?? 0)})
    RETURNING "id"
  `
  return created[0].id
}
