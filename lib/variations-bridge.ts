import { prisma } from '@/lib/db/prisma'
import { slugify } from '@/modules/shop/lib/slug'
import type { PatVariantRef } from '@/modules/product-attributes-for-shop/lib/types'

// shop-variations is an OPTIONAL companion, not a hard dependency: this module
// filters a plain shop catalogue perfectly well on its own. So everything here
// talks to the svr_ tables through raw SQL and never imports from
// '@/modules/shop-variations/...' - that path does not exist on an install
// without the module, and a static import would break the build there.
//
// Presence is probed with to_regclass rather than the Module table: the tables
// are what the queries actually need, and a module row can exist while its
// migration has not run yet.

let cached: { value: boolean; at: number } | null = null
const TTL_MS = 30_000

export async function hasVariationsTables(): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (
      to_regclass('public.svr_variants') IS NOT NULL
      AND to_regclass('public.svr_options') IS NOT NULL
      AND to_regclass('public.svr_option_values') IS NOT NULL
      AND to_regclass('public.svr_variant_values') IS NOT NULL
    ) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  cached = { value, at: Date.now() }
  return value
}

// Drops the cached probe result. The TTL above means a shop-variations install
// can take up to 30s to be noticed by a warm server; call this to force the next
// read to re-probe.
export function resetVariationsProbeCache(): void {
  cached = null
}

// The variants of a product, labelled by their option values ("Red / Small"),
// for the per-variant assignment UI. Empty when shop-variations is absent or the
// product has no variants.
export async function listVariantsForProduct(productId: string): Promise<PatVariantRef[]> {
  if (!(await hasVariationsTables())) return []
  const rows = await prisma.$queryRaw<{ child_product_id: string; enabled: boolean; position: number; label: string | null }[]>`
    SELECT
      v."child_product_id",
      v."enabled",
      v."position",
      string_agg(ov."label", ' / ' ORDER BY o."position" ASC, ov."position" ASC) AS "label"
    FROM "svr_variants" v
    LEFT JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    LEFT JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    LEFT JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE v."product_id" = ${productId}
    GROUP BY v."id", v."child_product_id", v."enabled", v."position"
    ORDER BY v."position" ASC
  `
  return rows.map((r) => ({
    childProductId: r.child_product_id,
    label: r.label ?? 'Variant',
    enabled: r.enabled,
  }))
}

export type VariationOption = {
  name: string
  values: { id: string; label: string; swatch: string | null; position: number }[]
}

// The product's variation options (Size, Colour) with their values - the raw
// material for the import.
export async function listVariationOptions(productId: string): Promise<VariationOption[]> {
  if (!(await hasVariationsTables())) return []
  const rows = await prisma.$queryRaw<
    { option_name: string; option_position: number; value_id: string; label: string; swatch: string | null; value_position: number }[]
  >`
    SELECT
      o."name" AS "option_name",
      o."position" AS "option_position",
      ov."id" AS "value_id",
      ov."label",
      ov."swatch",
      ov."position" AS "value_position"
    FROM "svr_options" o
    JOIN "svr_option_values" ov ON ov."option_id" = o."id"
    WHERE o."product_id" = ${productId}
    ORDER BY o."position" ASC, ov."position" ASC
  `
  const byName = new Map<string, VariationOption>()
  for (const row of rows) {
    const existing = byName.get(row.option_name) ?? { name: row.option_name, values: [] }
    existing.values.push({ id: row.value_id, label: row.label, swatch: row.swatch, position: row.value_position })
    byName.set(row.option_name, existing)
  }
  return [...byName.values()]
}

// Which option-value ids each variant child product is built from. Lets the
// import attach an imported attribute value to exactly the variants that carry
// the matching option value.
export async function getVariantOptionValueMap(productId: string): Promise<Map<string, string[]>> {
  if (!(await hasVariationsTables())) return new Map()
  const rows = await prisma.$queryRaw<{ child_product_id: string; option_value_id: string }[]>`
    SELECT v."child_product_id", vv."option_value_id"
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    WHERE v."product_id" = ${productId}
  `
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.child_product_id) ?? []
    list.push(row.option_value_id)
    map.set(row.child_product_id, list)
  }
  return map
}

// A stable slug for an imported value, so re-importing matches the existing row
// instead of duplicating it.
export function importedValueSlug(label: string): string {
  return slugify(label) || 'value'
}

// This module's id at the `shop-variations.option-source` point, as declared in
// its own manifest. Options built from an attribute store it in source_provider,
// so it is what tells our options apart from another provider's.
const OPTION_SOURCE_PROVIDER_ID = 'product-attributes'

export type SourcedOptionRenameResult = {
  /** Options renamed to follow the attribute. */
  renamed: number
  /**
   * Products where an option could not follow, because another option there is
   * already called that. Named so the caller can say which, rather than leaving
   * the owner to notice a stale name later.
   */
  blocked: string[]
}

/**
 * Bring every option built from this attribute into line with its new name.
 *
 * Options with `name_overridden` are deliberately left alone: an owner who
 * renamed one to "Seat colour" so it could sit beside "Back colour" off the same
 * attribute meant it, and having a rename here silently undo that would collapse
 * the two back into a clash.
 *
 * A rename is also skipped where the product already has an option by the new
 * name. Option names are unique per product - the importer matches on them and
 * two identically named choosers tell a customer nothing - so the alternative is
 * a constraint violation that would fail the whole attribute rename.
 */
export async function renameSourcedOptions(attributeId: string, name: string): Promise<SourcedOptionRenameResult> {
  if (!(await hasVariationsTables())) return { renamed: 0, blocked: [] }

  const clashes = await prisma.$queryRaw<{ product_name: string }[]>`
    SELECT DISTINCT p."name" AS "product_name"
    FROM "svr_options" o
    JOIN "shp_products" p ON p."id" = o."product_id"
    WHERE o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
      AND o."source_ref" = ${attributeId}
      AND o."name_overridden" = false
      AND lower(o."name") <> lower(${name})
      AND EXISTS (
        SELECT 1 FROM "svr_options" sib
        WHERE sib."product_id" = o."product_id"
          AND sib."id" <> o."id"
          AND lower(sib."name") = lower(${name})
      )
  `

  // At most one option per product may take the name, hence the DISTINCT ON.
  // Two non-overridden options off one attribute on one product cannot be made
  // through the UI - naming the second one differently is what sets its override
  // - but nothing at the database level forbids it, and without this guard the
  // statement would rename both to the same thing in a single snapshot and quietly
  // break the per-product name uniqueness the importer matches on.
  const renamed = await prisma.$executeRaw`
    UPDATE "svr_options" o
    SET "name" = ${name}
    WHERE o."id" IN (
      SELECT DISTINCT ON (cand."product_id") cand."id"
      FROM "svr_options" cand
      WHERE cand."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
        AND cand."source_ref" = ${attributeId}
        AND cand."name_overridden" = false
        AND cand."name" <> ${name}
      ORDER BY cand."product_id", cand."position", cand."id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "svr_options" sib
      WHERE sib."product_id" = o."product_id"
        AND sib."id" <> o."id"
        AND lower(sib."name") = lower(${name})
    )
  `

  return { renamed, blocked: clashes.map((r) => r.product_name) }
}
