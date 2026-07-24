import { prisma } from '@/lib/db/prisma'

// The product page's Specification content, assembled for the public product
// page. Read-only and JSON-serialisable, because it crosses the RSC boundary to
// the panel shop hands it to (lib/detail-spec-provider.ts).

// One line in the table: an attribute's shown name and its ticked value(s),
// joined - "Tilt" / "Synchro tilt, anti-shock".
export type PatSpecRow = { label: string; value: string }

// A run of rows under one heading. `name` is null for the unsectioned run, which
// is shown before the first real heading.
export type PatSpecSectionView = { id: string | null; name: string | null; rows: PatSpecRow[] }

export type PatProductSpecView = { sections: PatSpecSectionView[] }

/**
 * The product's Specification content, or null when the product has nothing to
 * show there - which is what keeps shop's own facts table in place until an
 * attribute is actually flagged for the page.
 *
 * Only product-level helpings marked show_in_spec are read: a use-for-variations
 * helping has no single value on the parent (it changes per variant), so it has
 * no place in a static spec row and is left out even if flagged. A flagged
 * helping with nothing ticked is dropped too, rather than printing a blank row.
 */
export async function getProductSpecView(productId: string): Promise<PatProductSpecView | null> {
  const [helpings, sections, values] = await Promise.all([
    prisma.$queryRaw<{
      id: string; name: string; spec_section_id: string | null; spec_position: number
    }[]>`
      SELECT ppa."id",
             COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS "name",
             ppa."spec_section_id", ppa."spec_position"
      FROM "pat_product_attributes" ppa
      JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
      WHERE ppa."product_id" = ${productId}
        AND ppa."show_in_spec" = true
        AND ppa."use_for_variations" = false
      ORDER BY ppa."spec_position" ASC, a."position" ASC, a."created_at" ASC
    `,
    prisma.$queryRaw<{ id: string; name: string; position: number }[]>`
      SELECT "id", "name", "position"
      FROM "pat_product_spec_sections"
      WHERE "product_id" = ${productId}
      ORDER BY "position" ASC, "created_at" ASC
    `,
    prisma.$queryRaw<{ assignment_id: string; label: string }[]>`
      SELECT pv."assignment_id", av."label"
      FROM "pat_product_values" pv
      JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
      JOIN "pat_product_attributes" ppa ON ppa."id" = pv."assignment_id"
      WHERE ppa."product_id" = ${productId}
        AND ppa."show_in_spec" = true
        AND ppa."use_for_variations" = false
      ORDER BY av."position" ASC, av."label" ASC
    `,
  ])

  if (helpings.length === 0) return null

  const valuesByAssignment = new Map<string, string[]>()
  for (const v of values) {
    const list = valuesByAssignment.get(v.assignment_id) ?? []
    list.push(v.label)
    valuesByAssignment.set(v.assignment_id, list)
  }

  const rowFor = (h: { id: string; name: string }): PatSpecRow | null => {
    const labels = valuesByAssignment.get(h.id)
    if (!labels || labels.length === 0) return null
    return { label: h.name, value: labels.join(', ') }
  }

  // The unsectioned run first, then each section in its own order. A helping
  // whose section was deleted carries spec_section_id NULL (ON DELETE SET NULL),
  // so it simply rejoins the unsectioned run rather than vanishing.
  const unsectioned: PatSpecRow[] = []
  const bySection = new Map<string, PatSpecRow[]>()
  for (const h of helpings) {
    const row = rowFor(h)
    if (!row) continue
    if (h.spec_section_id && sections.some((s) => s.id === h.spec_section_id)) {
      const list = bySection.get(h.spec_section_id) ?? []
      list.push(row)
      bySection.set(h.spec_section_id, list)
    } else {
      unsectioned.push(row)
    }
  }

  const out: PatSpecSectionView[] = []
  if (unsectioned.length > 0) out.push({ id: null, name: null, rows: unsectioned })
  for (const s of sections) {
    const rows = bySection.get(s.id)
    if (rows && rows.length > 0) out.push({ id: s.id, name: s.name, rows })
  }

  if (out.length === 0) return null
  return { sections: out }
}
