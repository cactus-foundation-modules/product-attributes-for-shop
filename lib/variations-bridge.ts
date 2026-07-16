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

// Test seam: the presence probe is cached for a short window, which would
// otherwise make a module installed mid-session look absent.
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
