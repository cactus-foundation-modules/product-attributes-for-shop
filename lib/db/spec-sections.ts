import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { PatProductSpecSection } from '@/modules/product-attributes-for-shop/lib/types'

// A product's Specification-tab section headings ("Mechanisms", "Guarantee"),
// in the order the editor shows them. Everything here reads/writes
// pat_product_spec_sections. Sections are per product, so this is always scoped
// to one product id.

export async function listProductSpecSections(productId: string): Promise<PatProductSpecSection[]> {
  const rows = await prisma.$queryRaw<{ id: string; name: string; position: number }[]>`
    SELECT "id", "name", "position"
    FROM "pat_product_spec_sections"
    WHERE "product_id" = ${productId}
    ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map((r) => ({ id: r.id, name: r.name, position: r.position }))
}

// One section as the editor submits it. A kept section sends the id it already
// has; a newly added one has none yet. `key` is the browser-side handle the
// editor gives every section from the moment it is added, so the membership it
// carries can point at a section that has no saved id yet.
export type PatProductSpecSectionInput = {
  id?: string | null
  key: string
  name: string
  position: number
}

/**
 * Replaces a product's whole set of sections in one go, returning a map from the
 * editor's `key` to the saved section id - so the caller can resolve each
 * helping's chosen section (which the editor also refers to by `key`) to the id
 * to store against it.
 *
 * Kept sections are updated in place rather than deleted and re-made: an
 * attribute's spec_section_id hangs off the section id, and recreating it would
 * tip every attribute in the section back into the unsectioned run mid-save
 * (ON DELETE SET NULL). A section the owner dropped IS deleted, and that same
 * SET NULL is what then correctly frees its attributes.
 */
export async function setProductSpecSections(
  productId: string,
  rows: PatProductSpecSectionInput[],
): Promise<Map<string, string>> {
  return prisma.$transaction(async (tx) => {
    const keptIds = rows.map((r) => r.id).filter((id): id is string => !!id)
    if (keptIds.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "pat_product_spec_sections"
        WHERE "product_id" = ${productId} AND "id" NOT IN (${Prisma.join(keptIds)})
      `
    } else {
      await tx.$executeRaw`DELETE FROM "pat_product_spec_sections" WHERE "product_id" = ${productId}`
    }

    const keyToId = new Map<string, string>()
    for (const row of rows) {
      const name = row.name.trim()
      if (!name) continue
      if (row.id) {
        await tx.$executeRaw`
          UPDATE "pat_product_spec_sections"
          SET "name" = ${name}, "position" = ${row.position}
          WHERE "id" = ${row.id} AND "product_id" = ${productId}
        `
        keyToId.set(row.key, row.id)
        continue
      }
      const created = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "pat_product_spec_sections" ("product_id", "name", "position")
        VALUES (${productId}, ${name}, ${row.position})
        RETURNING "id"
      `
      const id = created[0]?.id
      if (id) keyToId.set(row.key, id)
    }
    return keyToId
  })
}
