import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { PatAttributeGroup } from '@/modules/product-attributes-for-shop/lib/types'

function mapGroup(r: Record<string, unknown>): PatAttributeGroup {
  return {
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    position: r.position as number,
  }
}

export async function listAttributeGroups(): Promise<PatAttributeGroup[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attribute_groups" ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map(mapGroup)
}

export async function getAttributeGroup(id: string): Promise<PatAttributeGroup | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_attribute_groups" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapGroup(rows[0]) : null
}

export async function createAttributeGroup(fields: {
  name: string
  slug: string
  position: number
}): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "pat_attribute_groups" ("name", "slug", "position")
    VALUES (${fields.name}, ${fields.slug}, ${fields.position})
    RETURNING "id"
  `
  return rows[0]
}

export async function updateAttributeGroup(
  id: string,
  fields: { name?: string; slug?: string; position?: number },
): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.name !== undefined) sets.push(Prisma.sql`"name" = ${fields.name}`)
  if (fields.slug !== undefined) sets.push(Prisma.sql`"slug" = ${fields.slug}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "pat_attribute_groups" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

// The group running order, same whole-list rewrite as the attributes one and for
// the same reason: positions are not enforced unique, so restating every row is
// what makes a swap reliable.
export async function setAttributeGroupPositions(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.$executeRaw`UPDATE "pat_attribute_groups" SET "position" = ${index} WHERE "id" = ${id}`,
    ),
  )
}

// Deleting a group leaves its attributes alone - the foreign key is ON DELETE
// SET NULL, so they fall back onto the ungrouped pile with every product
// assignment intact. The caller re-files their pictures afterwards.
export async function deleteAttributeGroup(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "pat_attribute_groups" WHERE "id" = ${id}`
}

// Case-insensitive duplicate guard, same reasoning as attribute names: two
// folders called "Materials" would be indistinguishable in the move dropdown.
export async function attributeGroupNameTaken(name: string, exceptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_attribute_groups"
    WHERE lower("name") = lower(${name}) AND "id" <> ${exceptId}
    LIMIT 1
  `
  return rows.length > 0
}

export async function nextAttributeGroupPosition(): Promise<number> {
  const rows = await prisma.$queryRaw<[{ next: number | null }]>`
    SELECT COALESCE(MAX("position"), -1) + 1 AS "next" FROM "pat_attribute_groups"
  `
  return Number(rows[0]?.next ?? 0)
}

export async function ensureUniqueGroupSlug(base: string, exceptId?: string): Promise<string> {
  let slug = base
  for (let n = 2; ; n++) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "pat_attribute_groups" WHERE "slug" = ${slug} AND "id" <> ${exceptId ?? ''} LIMIT 1
    `
    if (rows.length === 0) return slug
    slug = `${base}-${n}`
  }
}

// The attributes sitting in a group. Used to re-file their picture swatches when
// the group is renamed or deleted - the folder those pictures live in is built
// from the group's name, so both events move every one of them.
export async function listAttributeIdsInGroup(groupId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "pat_attributes" WHERE "group_id" = ${groupId}
  `
  return rows.map((r) => r.id)
}
