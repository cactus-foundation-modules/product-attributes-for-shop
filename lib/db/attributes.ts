import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { PatAttribute, PatAttributeValue, PatAttributeWithValues, PatControlType } from '@/modules/product-attributes-for-shop/lib/types'

function mapAttribute(r: Record<string, unknown>): PatAttribute {
  return {
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    controlType: r.control_type as PatControlType,
    position: r.position as number,
    showInFilters: r.show_in_filters as boolean,
    sourceOptionName: (r.source_option_name as string | null) ?? null,
  }
}

function mapValue(r: Record<string, unknown>): PatAttributeValue {
  return {
    id: r.id as string,
    attributeId: r.attribute_id as string,
    label: r.label as string,
    slug: r.slug as string,
    swatch: (r.swatch as string | null) ?? null,
    position: r.position as number,
  }
}

// Every attribute with its values, ordered for display. `filtersOnly` narrows to
// the ones the owner has chosen to expose on the storefront.
export async function listAttributes(opts?: { filtersOnly?: boolean }): Promise<PatAttributeWithValues[]> {
  const where = opts?.filtersOnly ? Prisma.sql`WHERE "show_in_filters" = true` : Prisma.empty
  const attributeRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attributes" ${where} ORDER BY "position" ASC, "created_at" ASC
  `
  const attributes = attributeRows.map(mapAttribute)
  if (attributes.length === 0) return []
  const valueRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attribute_values"
    WHERE "attribute_id" IN (${Prisma.join(attributes.map((a) => a.id))})
    ORDER BY "position" ASC, "label" ASC
  `
  const values = valueRows.map(mapValue)
  return attributes.map((a) => ({ ...a, values: values.filter((v) => v.attributeId === a.id) }))
}

export async function createAttribute(fields: {
  name: string
  slug: string
  controlType: PatControlType
  position: number
  sourceOptionName?: string | null
}): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "pat_attributes" ("name", "slug", "control_type", "position", "source_option_name")
    VALUES (${fields.name}, ${fields.slug}, ${fields.controlType}, ${fields.position}, ${fields.sourceOptionName ?? null})
    RETURNING "id"
  `
  return rows[0]
}

export async function updateAttribute(
  id: string,
  fields: { name?: string; slug?: string; controlType?: PatControlType; position?: number; showInFilters?: boolean },
): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.name !== undefined) sets.push(Prisma.sql`"name" = ${fields.name}`)
  if (fields.slug !== undefined) sets.push(Prisma.sql`"slug" = ${fields.slug}`)
  if (fields.controlType !== undefined) sets.push(Prisma.sql`"control_type" = ${fields.controlType}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (fields.showInFilters !== undefined) sets.push(Prisma.sql`"show_in_filters" = ${fields.showInFilters}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "pat_attributes" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteAttribute(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "pat_attributes" WHERE "id" = ${id}`
}

export async function getAttribute(id: string): Promise<PatAttribute | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attributes" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapAttribute(rows[0]) : null
}

// Case-insensitive duplicate guard. Two attributes sharing a name make the
// storefront filter ambiguous, so the rename is refused rather than allowed.
export async function attributeNameTaken(name: string, exceptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_attributes"
    WHERE lower("name") = lower(${name}) AND "id" <> ${exceptId}
    LIMIT 1
  `
  return rows.length > 0
}

export async function attributeValueLabelTaken(attributeId: string, label: string, exceptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_attribute_values"
    WHERE "attribute_id" = ${attributeId} AND lower("label") = lower(${label}) AND "id" <> ${exceptId}
    LIMIT 1
  `
  return rows.length > 0
}

// The value of an attribute whose label matches (case-insensitive), if any. The
// inline "add a value" boxes on the product editor use this to reuse the value
// somebody already made rather than refusing the addition: from a product's point
// of view typing "Oak" twice should just work, even though the attributes screen
// treats the same clash as a mistake worth pointing out.
export async function findAttributeValueByLabel(attributeId: string, label: string): Promise<PatAttributeValue | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attribute_values"
    WHERE "attribute_id" = ${attributeId} AND lower("label") = lower(${label})
    LIMIT 1
  `
  return rows[0] ? mapValue(rows[0]) : null
}

export async function createAttributeValue(fields: {
  attributeId: string
  label: string
  slug: string
  swatch: string | null
  position: number
}): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "pat_attribute_values" ("attribute_id", "label", "slug", "swatch", "position")
    VALUES (${fields.attributeId}, ${fields.label}, ${fields.slug}, ${fields.swatch}, ${fields.position})
    RETURNING "id"
  `
  return rows[0]
}

export async function updateAttributeValue(
  id: string,
  fields: { label?: string; slug?: string; swatch?: string | null; position?: number },
): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.label !== undefined) sets.push(Prisma.sql`"label" = ${fields.label}`)
  if (fields.slug !== undefined) sets.push(Prisma.sql`"slug" = ${fields.slug}`)
  if (fields.swatch !== undefined) sets.push(Prisma.sql`"swatch" = ${fields.swatch}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "pat_attribute_values" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteAttributeValue(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "pat_attribute_values" WHERE "id" = ${id}`
}

export async function getAttributeValue(id: string): Promise<PatAttributeValue | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attribute_values" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapValue(rows[0]) : null
}

export async function getAttributeValueOwner(id: string): Promise<{ attributeId: string } | null> {
  const rows = await prisma.$queryRaw<{ attribute_id: string }[]>`
    SELECT "attribute_id" FROM "pat_attribute_values" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? { attributeId: rows[0].attribute_id } : null
}

// Maps each of the given value ids to the attribute it belongs to. Lets a caller
// tell, in one query, which values sit under a use-for-variations attribute.
export async function getValueAttributeMap(valueIds: string[]): Promise<Map<string, string>> {
  if (valueIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<{ id: string; attribute_id: string }[]>`
    SELECT "id", "attribute_id" FROM "pat_attribute_values" WHERE "id" IN (${Prisma.join(valueIds)})
  `
  return new Map(rows.map((r) => [r.id, r.attribute_id]))
}

// Next free position for a new row, so additions land at the end rather than
// colliding on 0.
export async function nextAttributePosition(): Promise<number> {
  const rows = await prisma.$queryRaw<[{ next: number | null }]>`
    SELECT COALESCE(MAX("position"), -1) + 1 AS "next" FROM "pat_attributes"
  `
  return Number(rows[0]?.next ?? 0)
}

export async function nextValuePosition(attributeId: string): Promise<number> {
  const rows = await prisma.$queryRaw<[{ next: number | null }]>`
    SELECT COALESCE(MAX("position"), -1) + 1 AS "next" FROM "pat_attribute_values" WHERE "attribute_id" = ${attributeId}
  `
  return Number(rows[0]?.next ?? 0)
}

// Slug uniqueness. Attribute slugs are global (they become the filter's query
// key); value slugs only need to be unique within their attribute.
export async function ensureUniqueAttributeSlug(base: string, exceptId?: string): Promise<string> {
  let slug = base
  for (let n = 2; ; n++) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "pat_attributes" WHERE "slug" = ${slug} AND "id" <> ${exceptId ?? ''} LIMIT 1
    `
    if (rows.length === 0) return slug
    slug = `${base}-${n}`
  }
}

export async function ensureUniqueValueSlug(attributeId: string, base: string, exceptId?: string): Promise<string> {
  let slug = base
  for (let n = 2; ; n++) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "pat_attribute_values"
      WHERE "attribute_id" = ${attributeId} AND "slug" = ${slug} AND "id" <> ${exceptId ?? ''} LIMIT 1
    `
    if (rows.length === 0) return slug
    slug = `${base}-${n}`
  }
}
