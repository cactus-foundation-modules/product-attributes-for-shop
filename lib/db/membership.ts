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
  }[]>`
    SELECT ppa."id", ppa."attribute_id", ppa."name_override", ppa."position",
           ppa."use_for_variations", ppa."show_in_filters"
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
}

/**
 * Replaces a product's whole set in one go, returning the assignment id each
 * submitted helping ended up with (by its index in `rows`), so the caller can
 * save the ticked values against them.
 *
 * Helpings the owner kept are updated in place rather than deleted and re-made:
 * their id is what the value rows hang off, and recreating it would cascade
 * every tick away mid-save.
 */
export async function setProductAttributes(
  productId: string,
  rows: PatProductAttributeInput[],
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
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
              "use_for_variations" = ${row.useForVariations}, "show_in_filters" = ${row.showInFilters}
          WHERE "id" = ${row.id} AND "product_id" = ${productId}
        `
        ids.push(row.id)
        continue
      }
      // The join to pat_attributes drops a helping naming an attribute that has
      // since been deleted, rather than erroring the whole save.
      const created = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "pat_product_attributes"
          ("product_id", "attribute_id", "name_override", "position", "use_for_variations", "show_in_filters")
        SELECT ${productId}, a."id", ${name}, ${position}, ${row.useForVariations}, ${row.showInFilters}
        FROM "pat_attributes" a WHERE a."id" = ${row.attributeId}
        RETURNING "id"
      `
      ids.push(created[0]?.id ?? '')
    }
    return ids
  })
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
