import { prisma } from '@/lib/db/prisma'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { summariseSpecValues, distinctSpecValues } from '@/modules/product-attributes-for-shop/lib/spec-format'
import type { Breakpoints } from '@/modules/shop/lib/breakpoints-shared'

// The product page's Specification content, assembled for the public product
// page. Read-only and JSON-serialisable, because it crosses the RSC boundary to
// the panel shop hands it to (lib/detail-spec-provider.ts).

// One line in the table: an attribute's shown name and its value.
//
// `value` is what the row says before the shopper has settled on a variation -
// the ticked value(s) of a plain row, or a summary of the whole listing on a row
// that differs per variation ("57cm - 79cm", "92 choices - ..."). It is what the
// server renders, so it is also what a crawler and a no-JavaScript visitor keep.
//
// `perVariant` is present only on a row that DOES differ by variation: one entry
// per id in the view's `variantIds`, in that order, null where the variation
// carries nothing for the row (a bespoke-only line on a stock chair, say) and
// the whole row is then dropped for that variation. Parallel arrays rather than
// a keyed object on purpose - the biggest listing here has over five hundred
// variations, and repeating a uuid on every row of every section would dwarf the
// page it is describing.
export type PatSpecRow = { label: string; value: string; perVariant?: (string | null)[] }

// A run of rows under one heading. `name` is null for the unsectioned run, which
// is shown before the first real heading.
export type PatSpecSectionView = { id: string | null; name: string | null; rows: PatSpecRow[] }

export type PatProductSpecView = {
  // The listing product, so the panel can ignore a selection broadcast by some
  // other product's island on the same page.
  parentProductId: string
  // The enabled variations any per-variant row has a value for, listed once and
  // indexed by every `perVariant` array. Absent when no row varies.
  variantIds?: string[]
  sections: PatSpecSectionView[]
}

// What the panel is actually handed: the view plus the site's own responsive
// breakpoints, added by lib/detail-spec-provider.ts. Media queries cannot read
// CSS custom properties, so the widths the group grid collapses at have to be
// baked into the panel's <style> at render time - same approach as the shop's
// grids and this module's filter panel. Optional because the panel falls back to
// the platform defaults if it is ever rendered without them.
export type PatSpecPanelPayload = PatProductSpecView & { breakpoints?: Breakpoints }

/**
 * The product's Specification content, or null when the product has nothing to
 * show there - which is what keeps shop's own facts table in place until an
 * attribute is actually flagged for the page.
 *
 * Every helping marked show_in_spec is read, and its value can come from either
 * side: the value(s) ticked on the product itself, and/or a value ticked on each
 * individual variation. Whether the helping is use-for-variations makes no
 * difference here - a chair's seat height is not something anyone picks from a
 * dropdown, but it still changes with the draughtsman kit, so it is stored per
 * variation against an ordinary helping. A helping that resolves to nothing is
 * dropped, rather than printing a blank row.
 *
 * A row with per-variation values carries both: a summary for the shopper who
 * has not chosen yet, and the per-variation values themselves so the panel can
 * swap in the exact one the moment they do.
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
    // Ordinary helpings: the value(s) ticked on the LISTING itself.
    //
    // Scoped to the listing's own row on purpose. A variation stores its value
    // against its parent's assignment (that is what the query below reads), so
    // joining on the assignment alone hands back every variation's tick as
    // though the listing carried them all: a chair offered in twenty fabrics
    // read as one listing ticked "Camira" twenty times, and that string then
    // stood in as the fallback for any variation with nothing of its own.
    prisma.$queryRaw<{ assignment_id: string; label: string }[]>`
      SELECT pv."assignment_id", av."label"
      FROM "pat_product_values" pv
      JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
      JOIN "pat_product_attributes" ppa ON ppa."id" = pv."assignment_id"
      WHERE ppa."product_id" = ${productId}
        AND pv."product_id" = ppa."product_id"
        AND ppa."show_in_spec" = true
        AND ppa."use_for_variations" = false
      ORDER BY av."position" ASC, av."label" ASC
    `,
    // The values the product's individual variations carry, one row per
    // (variation, helping, value). Not collapsed to distinct labels the way it
    // once was: the panel needs to know WHICH variation holds which value, and
    // the distinct set is derived from these below anyway.
    //
    // Every show_in_spec helping is read, not only the use-for-variations ones.
    // The two flags answer different questions - "is this a dropdown on the
    // page" and "does this differ between the things in the dropdown" - and a
    // chair's dimensions are the second without being the first.
    //
    // Disabled variants are left out to match what the storefront counts as
    // buyable. Guarded on the svr_ tables being present - a spec helping with
    // per-variant values can outlive an uninstall of shop-variations, and
    // referencing a missing table would error the query.
    variationsInstalled
      ? prisma.$queryRaw<{ child_product_id: string; assignment_id: string; label: string }[]>`
          SELECT sv."child_product_id", ppa."id" AS "assignment_id", av."label"
          FROM "pat_product_attributes" ppa
          JOIN "svr_variants" sv
            ON sv."product_id" = ppa."product_id" AND sv."enabled" = true
          JOIN "pat_product_values" pv
            ON pv."product_id" = sv."child_product_id" AND pv."assignment_id" = ppa."id"
          JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
          WHERE ppa."product_id" = ${productId}
            AND ppa."show_in_spec" = true
          ORDER BY sv."position" ASC, sv."created_at" ASC, av."position" ASC, av."label" ASC
        `
      : Promise.resolve([] as { child_product_id: string; assignment_id: string; label: string }[]),
  ])

  if (helpings.length === 0) return null

  // The product's own ticks, joined as before: several ticked values on one
  // helping are one row's worth of answer ("Synchro tilt, anti-shock").
  const ownByAssignment = new Map<string, string[]>()
  for (const v of ownValues) {
    const list = ownByAssignment.get(v.assignment_id) ?? []
    list.push(v.label)
    ownByAssignment.set(v.assignment_id, list)
  }

  // assignment -> variation -> that variation's answer for the row. Variations
  // are numbered in the order the query returned them, which is the order the
  // owner arranged them in, so `variantIds` and every perVariant array agree.
  const variantOrder = new Map<string, number>()
  const byAssignment = new Map<string, Map<string, string[]>>()
  for (const v of variantValues) {
    if (!variantOrder.has(v.child_product_id)) variantOrder.set(v.child_product_id, variantOrder.size)
    let forAssignment = byAssignment.get(v.assignment_id)
    if (!forAssignment) {
      forAssignment = new Map<string, string[]>()
      byAssignment.set(v.assignment_id, forAssignment)
    }
    const labels = forAssignment.get(v.child_product_id) ?? []
    labels.push(v.label)
    forAssignment.set(v.child_product_id, labels)
  }
  const variantIds = [...variantOrder.keys()]

  const rowFor = (h: { id: string; name: string }): PatSpecRow | null => {
    const own = ownByAssignment.get(h.id)
    const ownValue = own && own.length > 0 ? own.join(', ') : null
    const forAssignment = byAssignment.get(h.id)

    // A plain row: nothing about it changes with the variation chosen.
    if (!forAssignment || forAssignment.size === 0) {
      return ownValue ? { label: h.name, value: ownValue } : null
    }

    // A per-variation row. A variation with no value of its own falls back to
    // whatever is ticked on the listing itself, and only shows nothing - and so
    // drops the row - when the listing has nothing either.
    const perVariant = variantIds.map((id) => {
      const labels = forAssignment.get(id)
      return labels && labels.length > 0 ? labels.join(', ') : ownValue
    })
    const distinct = distinctSpecValues(perVariant)
    const only = distinct[0]
    if (only === undefined) return null
    // Every variation saying the same thing is a plain row wearing a costume:
    // the import should have stored it on the listing, but a row that says
    // "3 Years" whichever chair you pick has no business being highlighted as
    // your choice.
    if (distinct.length === 1 && perVariant.every((v) => v !== null)) {
      return { label: h.name, value: only }
    }
    return { label: h.name, value: summariseSpecValues(distinct), perVariant }
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
  // The id list is only worth carrying when something indexes it. A listing
  // whose rows all collapsed to one value ships the same payload it always did.
  const varies = out.some((s) => s.rows.some((r) => r.perVariant))
  return varies
    ? { parentProductId: productId, variantIds, sections: out }
    : { parentProductId: productId, sections: out }
}
