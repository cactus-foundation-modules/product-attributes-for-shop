import { prisma } from '@/lib/db/prisma'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

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
 * Every helping marked show_in_spec is read, ordinary and use-for-variations
 * alike. The two differ only in where the value comes from: an ordinary helping
 * shows the value(s) ticked on the product itself, while a per-variant helping
 * has no single value on the parent, so it shows the distinct set its enabled
 * variants carry - "Upholstery: Black, Grey, Blue". Either way a flagged helping
 * that resolves to nothing is dropped, rather than printing a blank row.
 */
export async function getProductSpecView(productId: string): Promise<PatProductSpecView | null> {
  const variationsInstalled = await hasVariationsTables()
  const [helpings, sections, ownValues, variantValues] = await Promise.all([
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
      ORDER BY ppa."spec_position" ASC, a."position" ASC, a."created_at" ASC
    `,
    prisma.$queryRaw<{ id: string; name: string; position: number }[]>`
      SELECT "id", "name", "position"
      FROM "pat_product_spec_sections"
      WHERE "product_id" = ${productId}
      ORDER BY "position" ASC, "created_at" ASC
    `,
    // Ordinary helpings: the value(s) ticked on the product itself.
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
    // Per-variant helpings: the distinct values across the product's enabled
    // variants for that helping's own column. GROUP BY collapses a value shared
    // by many variants to one label, and disabled variants are left out to match
    // what the storefront filter counts as buyable. Guarded on the svr_ tables
    // being present - a variation helping can outlive an uninstall of
    // shop-variations, and referencing a missing table would error the query.
    variationsInstalled
      ? prisma.$queryRaw<{ assignment_id: string; label: string }[]>`
          SELECT ppa."id" AS "assignment_id", av."label"
          FROM "pat_product_attributes" ppa
          JOIN "svr_variants" sv
            ON sv."product_id" = ppa."product_id" AND sv."enabled" = true
          JOIN "pat_product_values" pv
            ON pv."product_id" = sv."child_product_id" AND pv."assignment_id" = ppa."id"
          JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
          WHERE ppa."product_id" = ${productId}
            AND ppa."show_in_spec" = true
            AND ppa."use_for_variations" = true
          GROUP BY ppa."id", av."id", av."label", av."position"
          ORDER BY av."position" ASC, av."label" ASC
        `
      : Promise.resolve([] as { assignment_id: string; label: string }[]),
  ])

  if (helpings.length === 0) return null

  const valuesByAssignment = new Map<string, string[]>()
  for (const v of [...ownValues, ...variantValues]) {
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
