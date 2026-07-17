import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { slugify } from '@/modules/shop/lib/slug'
import type { PatProductAttribute, PatVariationColumn } from '@/modules/product-attributes-for-shop/lib/types'

// The attribute "set" for a product: which attributes it uses and the two
// per-(product, attribute) flags. Everything here reads/writes pat_product_attributes.

// The product's chosen attributes with their flags.
export async function getProductAttributes(productId: string): Promise<PatProductAttribute[]> {
  const rows = await prisma.$queryRaw<{ attribute_id: string; use_for_variations: boolean; show_in_filters: boolean }[]>`
    SELECT "attribute_id", "use_for_variations", "show_in_filters"
    FROM "pat_product_attributes" WHERE "product_id" = ${productId}
  `
  return rows.map((r) => ({
    attributeId: r.attribute_id,
    useForVariations: r.use_for_variations,
    showInFilters: r.show_in_filters,
  }))
}

// Replaces a product's whole set in one go. Rows referencing an attribute that no
// longer exists are dropped by the WHERE on insert rather than erroring.
export async function setProductAttributes(productId: string, rows: PatProductAttribute[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "pat_product_attributes" WHERE "product_id" = ${productId}`
    for (const row of rows) {
      await tx.$executeRaw`
        INSERT INTO "pat_product_attributes" ("product_id", "attribute_id", "use_for_variations", "show_in_filters")
        SELECT ${productId}, a."id", ${row.useForVariations}, ${row.showInFilters}
        FROM "pat_attributes" a WHERE a."id" = ${row.attributeId}
        ON CONFLICT ("product_id", "attribute_id")
        DO UPDATE SET "use_for_variations" = EXCLUDED."use_for_variations", "show_in_filters" = EXCLUDED."show_in_filters"
      `
    }
  })
}

// Upserts a single membership row without disturbing the rest of the set. Used by
// the "Copy from variations" import so it can mark the attributes it touched as
// used-for-variations without clearing anything the admin set by hand.
export async function upsertProductAttribute(productId: string, row: PatProductAttribute): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "pat_product_attributes" ("product_id", "attribute_id", "use_for_variations", "show_in_filters")
    SELECT ${productId}, a."id", ${row.useForVariations}, ${row.showInFilters}
    FROM "pat_attributes" a WHERE a."id" = ${row.attributeId}
    ON CONFLICT ("product_id", "attribute_id")
    DO UPDATE SET "use_for_variations" = EXCLUDED."use_for_variations"
  `
}

// The product's use-for-variations attributes with their selectable values, in
// display order - the columns the Variations tab shows and the CSV carries.
export async function listVariationColumns(productId: string): Promise<PatVariationColumn[]> {
  const rows = await prisma.$queryRaw<
    { attribute_id: string; name: string; position: number; value_id: string | null; label: string | null; swatch: string | null }[]
  >`
    SELECT a."id" AS "attribute_id", a."name", a."position",
           av."id" AS "value_id", av."label", av."swatch"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    LEFT JOIN "pat_attribute_values" av ON av."attribute_id" = a."id"
    WHERE ppa."product_id" = ${productId} AND ppa."use_for_variations" = true
    ORDER BY a."position" ASC, a."created_at" ASC, av."position" ASC, av."label" ASC
  `
  const byAttr = new Map<string, PatVariationColumn>()
  for (const r of rows) {
    let col = byAttr.get(r.attribute_id)
    if (!col) {
      col = { attributeId: r.attribute_id, name: r.name, position: r.position, values: [] }
      byAttr.set(r.attribute_id, col)
    }
    if (r.value_id) col.values.push({ id: r.value_id, label: r.label ?? '', swatch: r.swatch })
  }
  return [...byAttr.values()]
}

// Current per-variant value for each of the product's use-for-variations
// attributes, keyed by child product id then attribute id. Only variation
// attributes are returned, so a value ticked on the product for a non-variation
// attribute never leaks in here.
export async function getVariantAttributeValues(
  productId: string,
  childProductIds: string[],
): Promise<Record<string, Record<string, { valueId: string; label: string }>>> {
  const result: Record<string, Record<string, { valueId: string; label: string }>> = {}
  if (childProductIds.length === 0) return result
  const rows = await prisma.$queryRaw<{ child_id: string; attribute_id: string; value_id: string; label: string }[]>`
    SELECT pv."product_id" AS "child_id", av."attribute_id", av."id" AS "value_id", av."label"
    FROM "pat_product_values" pv
    JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
    JOIN "pat_product_attributes" ppa
      ON ppa."attribute_id" = av."attribute_id" AND ppa."product_id" = ${productId} AND ppa."use_for_variations" = true
    WHERE pv."product_id" IN (${Prisma.join(childProductIds)})
  `
  for (const r of rows) {
    ;(result[r.child_id] ??= {})[r.attribute_id] = { valueId: r.value_id, label: r.label }
  }
  return result
}

// Sets (or clears, with valueId null) one variant child's value for one
// attribute. A variation attribute is single-select per variant, so every other
// value of the same attribute is removed first.
export async function setVariantAttributeValue(
  childProductId: string,
  attributeId: string,
  valueId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "pat_product_values"
      WHERE "product_id" = ${childProductId}
        AND "value_id" IN (SELECT "id" FROM "pat_attribute_values" WHERE "attribute_id" = ${attributeId})
    `
    if (valueId) {
      await tx.$executeRaw`
        INSERT INTO "pat_product_values" ("product_id", "value_id")
        SELECT ${childProductId}, av."id" FROM "pat_attribute_values" av
        WHERE av."id" = ${valueId} AND av."attribute_id" = ${attributeId}
        ON CONFLICT DO NOTHING
      `
    }
  })
}

// The id of an attribute's value matching a label (case-insensitive), creating it
// if absent. Lets a sheet edit that names a not-yet-existing value round-trip,
// the same way importing options auto-creates values.
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
