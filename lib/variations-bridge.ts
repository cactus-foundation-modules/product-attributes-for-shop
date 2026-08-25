import { Prisma } from '@prisma/client'
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
  // The slug column check keeps this module honest against an OLD shop-variations
  // (installed but not yet migrated to per-value slugs): the queries here read
  // ov."slug", and running them against a slugless table would turn every value
  // edit into an error. Until the companion catches up, behave as if it were
  // absent - degraded, self-healing, never broken.
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (
      to_regclass('public.svr_variants') IS NOT NULL
      AND to_regclass('public.svr_options') IS NOT NULL
      AND to_regclass('public.svr_option_values') IS NOT NULL
      AND to_regclass('public.svr_variant_values') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE "table_schema" = 'public' AND "table_name" = 'svr_option_values' AND "column_name" = 'slug'
      )
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
  delete copyColumnCached.swatch_small
  delete copyColumnCached.swatch_tiny
}

const copyColumnCached: Partial<Record<'swatch_small' | 'swatch_tiny', { value: boolean; at: number }>> = {}

// Whether the companion is new enough to hold a given shrunk swatch rendition
// per option value (its migration 013 for `swatch_small`, 017 for `swatch_tiny`
// on svr_option_values). Probed separately from hasVariationsTables so an OLD
// companion still gets every sync it always got - labels, swatches, slugs - and
// only the copies wait for it to catch up.
async function hasOptionValueColumn(column: 'swatch_small' | 'swatch_tiny'): Promise<boolean> {
  const cached = copyColumnCached[column]
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE "table_schema" = 'public' AND "table_name" = 'svr_option_values' AND "column_name" = ${column}
    ) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  copyColumnCached[column] = { value, at: Date.now() }
  return value
}

// The variants of a product, labelled by their option values ("Red / Small"),
// for the per-variant assignment UI. Empty when shop-variations is absent or the
// product has no variants.
export async function listVariantsForProduct(productId: string): Promise<PatVariantRef[]> {
  if (!(await hasVariationsTables())) return []
  const variants = await listVariantRows(productId)
  if (variants.length === 0) return []
  const values = await variantOptionValues(variants.map((v) => v.id))

  // Label assembled here rather than by string_agg, because the values now
  // arrive keyed by variant id (see variantOptionValues). Same ordering the SQL
  // had: option position, then value position within the option.
  const byVariant = new Map<string, { label: string; optionPosition: number; valuePosition: number }[]>()
  for (const v of values) {
    const list = byVariant.get(v.variant_id) ?? []
    list.push({ label: v.label, optionPosition: v.option_position, valuePosition: v.value_position })
    byVariant.set(v.variant_id, list)
  }

  return variants.map((variant) => {
    const parts = (byVariant.get(variant.id) ?? [])
      .sort((a, b) => a.optionPosition - b.optionPosition || a.valuePosition - b.valuePosition)
      .map((part) => part.label)
    // A variant carrying no option values still appears, named 'Variant' -
    // exactly what the LEFT JOIN and its null fallback produced before.
    return {
      childProductId: variant.childProductId,
      label: parts.length > 0 ? parts.join(' / ') : 'Variant',
      enabled: variant.enabled,
    }
  })
}

/** A product's variants, in matrix order. */
async function listVariantRows(productId: string): Promise<{ id: string; childProductId: string; enabled: boolean }[]> {
  const rows = await prisma.$queryRaw<{ id: string; child_product_id: string; enabled: boolean }[]>`
    SELECT "id", "child_product_id", "enabled" FROM "svr_variants"
    WHERE "product_id" = ${productId}
    ORDER BY "position" ASC
  `
  return rows.map((r) => ({ id: r.id, childProductId: r.child_product_id, enabled: r.enabled }))
}

/**
 * The option values carried by a set of variants, keyed by variant id.
 *
 * `= ANY($1::text[])` rather than joining back to svr_variants on product_id.
 * Asked as a join, Postgres costs the two sides, picks a hash join and
 * sequentially scans the WHOLE svr_variant_values table - on a 588-variant
 * product that is ~70,000 rows read to return ~2,300, and it was the largest
 * single source of wasted reads on the live install. Handed the variant ids it
 * uses the (variant_id, option_value_id) primary key as a covering index
 * instead: measured at roughly 3ms against 25ms, and the plan holds once
 * Postgres switches the prepared statement to a generic plan.
 *
 * The extra round trip for the ids is free in practice - svr_variants is
 * indexed on product_id, and both callers want the variant rows anyway.
 */
async function variantOptionValues(
  variantIds: string[],
): Promise<{ variant_id: string; option_value_id: string; label: string; option_position: number; value_position: number }[]> {
  if (variantIds.length === 0) return []
  return prisma.$queryRaw`
    SELECT vv."variant_id",
           vv."option_value_id",
           ov."label",
           o."position" AS "option_position",
           ov."position" AS "value_position"
    FROM "svr_variant_values" vv
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE vv."variant_id" = ANY(${variantIds}::text[])
  `
}

export type VariationOption = {
  name: string
  values: { id: string; label: string; slug: string; swatch: string | null; position: number }[]
}

// The product's variation options (Size, Colour) with their values - the raw
// material for the import.
export async function listVariationOptions(productId: string): Promise<VariationOption[]> {
  if (!(await hasVariationsTables())) return []
  const rows = await prisma.$queryRaw<
    { option_name: string; option_position: number; value_id: string; label: string; slug: string; swatch: string | null; value_position: number }[]
  >`
    SELECT
      o."name" AS "option_name",
      o."position" AS "option_position",
      ov."id" AS "value_id",
      ov."label",
      ov."slug",
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
    existing.values.push({ id: row.value_id, label: row.label, slug: row.slug, swatch: row.swatch, position: row.value_position })
    byName.set(row.option_name, existing)
  }
  return [...byName.values()]
}

// Which option-value ids each variant child product is built from. Lets the
// import attach an imported attribute value to exactly the variants that carry
// the matching option value.
export async function getVariantOptionValueMap(productId: string): Promise<Map<string, string[]>> {
  if (!(await hasVariationsTables())) return new Map()
  const variants = await listVariantRows(productId)
  if (variants.length === 0) return new Map()
  const childByVariant = new Map(variants.map((v) => [v.id, v.childProductId]))
  const rows = await variantOptionValues(variants.map((v) => v.id))
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const childProductId = childByVariant.get(row.variant_id)
    if (!childProductId) continue
    const list = map.get(childProductId) ?? []
    list.push(row.option_value_id)
    map.set(childProductId, list)
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

export type SourcedValueSyncResult = {
  /** Option values brought into line with this attribute value. */
  updated: number
  /**
   * Products where a copy could not follow a SLUG change, because another value
   * on the same option already holds that slug. Labels are never blocked any
   * more - duplicates are legal, told apart by slug.
   */
  blocked: string[]
  /** Variant child products whose names were re-composed off the new label. */
  variantsRenamed: number
}

/**
 * Bring every variation option value copied from this attribute value into line
 * with it, and re-compose the variant names that were built from it.
 *
 * The mirror image of renameSourcedOptions, one level down. Copies are matched
 * by `source_ref`, which is how the refresh in shop-variations finds them too -
 * so a rename here lands in exactly the places a manual "Refresh from source"
 * would have, without the owner having to visit every product to press it.
 *
 * Unlike an option name, a value label has no override flag: a copy either came
 * from this attribute value or it did not. Values typed in by hand carry no
 * source_ref and are never touched.
 */
export async function syncSourcedOptionValues(
  valueId: string,
  fields: { label?: string; swatch?: string | null; swatchSmall?: string | null; swatchTiny?: string | null; slug?: string },
): Promise<SourcedValueSyncResult> {
  const { label, swatch, swatchSmall, swatchTiny, slug } = fields
  if (label === undefined && swatch === undefined && swatchSmall === undefined && swatchTiny === undefined && slug === undefined) return { updated: 0, blocked: [], variantsRenamed: 0 }
  if (!(await hasVariationsTables())) return { updated: 0, blocked: [], variantsRenamed: 0 }

  // The copies, and the products they sit on. Read up front so the swatch and
  // label statements below judge the same set, and so a product only counts as
  // touched once however many of its options carry the value.
  const copies = await prisma.$queryRaw<{ id: string; option_id: string; product_id: string; product_name: string }[]>`
    SELECT ov."id", ov."option_id", o."product_id", p."name" AS "product_name"
    FROM "svr_option_values" ov
    JOIN "svr_options" o ON o."id" = ov."option_id"
    JOIN "shp_products" p ON p."id" = o."product_id"
    WHERE ov."source_ref" = ${valueId}
      AND o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
  `
  if (copies.length === 0) return { updated: 0, blocked: [], variantsRenamed: 0 }

  const touched = new Set<string>()
  const blocked = new Set<string>()
  let updated = 0

  if (swatch !== undefined) {
    // A swatch carries no uniqueness rule, so every copy takes it. An image
    // swatch is a url in this attribute's own media folder, which is what a
    // refresh copies across as well - the picture is shared, not duplicated.
    const rows = await prisma.$executeRaw`
      UPDATE "svr_option_values" ov
      SET "swatch" = ${swatch}
      WHERE ov."source_ref" = ${valueId}
        AND ov."option_id" IN (
          SELECT o."id" FROM "svr_options" o WHERE o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
        )
        AND ov."swatch" IS DISTINCT FROM ${swatch}
    `
    updated += rows
    if (rows > 0) for (const copy of copies) touched.add(copy.product_id)
  }

  // The shrunk copies follow the same everyone-takes-it rule as the swatch.
  // Skipped silently against a companion too old to hold one: the copies there
  // fall back to the next size up, which is exactly what they showed before the
  // rendition existed.
  if (swatchSmall !== undefined && (await hasOptionValueColumn('swatch_small'))) {
    const rows = await prisma.$executeRaw`
      UPDATE "svr_option_values" ov
      SET "swatch_small" = ${swatchSmall}
      WHERE ov."source_ref" = ${valueId}
        AND ov."option_id" IN (
          SELECT o."id" FROM "svr_options" o WHERE o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
        )
        AND ov."swatch_small" IS DISTINCT FROM ${swatchSmall}
    `
    updated += rows
  }

  if (swatchTiny !== undefined && (await hasOptionValueColumn('swatch_tiny'))) {
    const rows = await prisma.$executeRaw`
      UPDATE "svr_option_values" ov
      SET "swatch_tiny" = ${swatchTiny}
      WHERE ov."source_ref" = ${valueId}
        AND ov."option_id" IN (
          SELECT o."id" FROM "svr_options" o WHERE o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
        )
        AND ov."swatch_tiny" IS DISTINCT FROM ${swatchTiny}
    `
    updated += rows
  }

  if (label !== undefined) {
    // Duplicate labels are legal now - two "Black"s on one option are told apart
    // by slug and swatch - so every copy simply follows the rename. No clash
    // check, no copy left behind.
    const renamed = await prisma.$executeRaw`
      UPDATE "svr_option_values" ov
      SET "label" = ${label}
      FROM "svr_options" o
      WHERE o."id" = ov."option_id"
        AND ov."source_ref" = ${valueId}
        AND o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
        AND ov."label" <> ${label}
    `
    updated += renamed
    if (renamed > 0) for (const copy of copies) touched.add(copy.product_id)
  }

  if (slug !== undefined) {
    // The copies' slug follows the attribute's, so the sheet spelling
    // "(black-mfc)Black" reads the same on every product. Slugs ARE unique per
    // option, so a copy whose option already holds the new slug (a hand-typed
    // value, usually) is left as it was and the product named - and DISTINCT ON
    // keeps two copies of one source value on one option from both claiming it.
    const clashes = await prisma.$queryRaw<{ product_name: string }[]>`
      SELECT DISTINCT p."name" AS "product_name"
      FROM "svr_option_values" ov
      JOIN "svr_options" o ON o."id" = ov."option_id"
      JOIN "shp_products" p ON p."id" = o."product_id"
      WHERE ov."source_ref" = ${valueId}
        AND o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
        AND ov."slug" <> ${slug}
        AND EXISTS (
          SELECT 1 FROM "svr_option_values" sib
          WHERE sib."option_id" = ov."option_id"
            AND sib."id" <> ov."id"
            AND sib."slug" = ${slug}
        )
    `
    for (const row of clashes) blocked.add(row.product_name)

    const moved = await prisma.$executeRaw`
      UPDATE "svr_option_values" ov
      SET "slug" = ${slug}
      WHERE ov."id" IN (
        SELECT DISTINCT ON (cand."option_id") cand."id"
        FROM "svr_option_values" cand
        JOIN "svr_options" o ON o."id" = cand."option_id"
        WHERE cand."source_ref" = ${valueId}
          AND o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
          AND cand."slug" <> ${slug}
        ORDER BY cand."option_id", cand."position", cand."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "svr_option_values" sib
        WHERE sib."option_id" = ov."option_id"
          AND sib."id" <> ov."id"
          AND sib."slug" = ${slug}
      )
    `
    updated += moved
  }

  const variantsRenamed = label !== undefined && touched.size > 0
    ? await syncVariantChildNames([...touched])
    : 0

  return { updated, blocked: [...blocked], variantsRenamed }
}

export type SourcedOrderSyncResult = {
  /** Option value copies moved into this attribute's running order. */
  valuesMoved: number
  /** Variants whose position was re-derived from the new value order. */
  variantsResequenced: number
}

/**
 * Push this attribute's running order of values out to every variation option
 * copied from it, then put the variants already generated from those options
 * back in the order the new value order implies.
 *
 * shop-variations' own "refresh from source" deliberately syncs labels and
 * swatches but never positions - a copy keeps whatever slot it was created in.
 * That is why a reorder here has to say so explicitly rather than leaving it to
 * the next refresh: without this, dragging Oak above Ash on the attributes
 * screen would reorder the filter and the product editor while every variations
 * dropdown in the shop stayed in the old order.
 *
 * Values typed straight into shop-variations carry no `source_ref` and are not
 * owned by this attribute, so they keep their relative order and settle after
 * the sourced block rather than being interleaved by a rule nobody wrote down.
 */
export async function syncSourcedValueOrder(
  orderedValueIds: string[],
): Promise<SourcedOrderSyncResult> {
  if (orderedValueIds.length === 0) return { valuesMoved: 0, variantsResequenced: 0 }
  if (!(await hasVariationsTables())) return { valuesMoved: 0, variantsResequenced: 0 }

  // The products carrying a copy, read before the write so the variant
  // resequence below judges the same set the renumber touched.
  const copies = await prisma.$queryRaw<{ product_id: string }[]>`
    SELECT DISTINCT o."product_id"
    FROM "svr_option_values" ov
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE ov."source_ref" IN (${Prisma.join(orderedValueIds)})
      AND o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
  `
  if (copies.length === 0) return { valuesMoved: 0, variantsResequenced: 0 }
  const productIds = copies.map((r) => r.product_id)

  // The order as a rank table. Casts are explicit because an untyped parameter
  // in a VALUES list comes through as text, which would sort "10" below "9".
  const ranks = Prisma.join(
    orderedValueIds.map((id, index) => Prisma.sql`(${id}::text, ${index}::int)`),
    ', ',
  )

  // Every value on a touched option is renumbered, not just the sourced ones:
  // ROW_NUMBER over the whole option is what keeps the result a clean 0..n with
  // no collisions, and `src."rank" IS NULL` sorting last is what parks the
  // hand-typed values after the block this attribute owns, in the order they
  // were already in.
  const valuesMoved = await prisma.$executeRaw`
    WITH "src"("ref", "rank") AS (VALUES ${ranks}),
    "affected" AS (
      SELECT DISTINCT ov."option_id"
      FROM "svr_option_values" ov
      JOIN "svr_options" o ON o."id" = ov."option_id"
      JOIN "src" ON "src"."ref" = ov."source_ref"
      WHERE o."source_provider" = ${OPTION_SOURCE_PROVIDER_ID}
    ),
    "ranked" AS (
      SELECT
        ov."id",
        (ROW_NUMBER() OVER (
          PARTITION BY ov."option_id"
          ORDER BY ("src"."rank" IS NULL), "src"."rank", ov."position", ov."id"
        ) - 1)::int AS "pos"
      FROM "svr_option_values" ov
      JOIN "affected" a ON a."option_id" = ov."option_id"
      LEFT JOIN "src" ON "src"."ref" = ov."source_ref"
    )
    UPDATE "svr_option_values" ov
    SET "position" = "ranked"."pos"
    FROM "ranked"
    WHERE ov."id" = "ranked"."id"
      AND ov."position" IS DISTINCT FROM "ranked"."pos"
  `

  const variantsResequenced = await resequenceVariants(productIds)
  return { valuesMoved, variantsResequenced }
}

/**
 * Put every already-generated variant of these products back into the order its
 * option values now imply, without touching a single variant id.
 *
 * shop-variations generates the matrix odometer-style - options left to right,
 * the last option cycling fastest - and stores the result as a plain `position`
 * per variant. Reordering the values underneath leaves those numbers describing
 * an order that no longer exists, so the Variations grid shows Ash above Oak
 * long after the owner moved Oak up.
 *
 * The fix is a renumber, never a regenerate: a variant carries its own stock,
 * price, photographs and any order ever placed against it, so deleting and
 * recreating the matrix to get the order right would be an act of vandalism
 * dressed as a sort. Each variant's key is the array of its value positions
 * taken in option order; Postgres compares arrays element by element, which is
 * exactly the odometer the generator used, so ROW_NUMBER over that key
 * reproduces what a fresh generation would have produced.
 */
async function resequenceVariants(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0
  return prisma.$executeRaw`
    WITH "keyed" AS (
      SELECT
        v."id",
        v."product_id",
        array_agg(ov."position" ORDER BY o."position" ASC, o."created_at" ASC, o."id" ASC) AS "key"
      FROM "svr_variants" v
      JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
      JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
      JOIN "svr_options" o ON o."id" = ov."option_id"
      WHERE v."product_id" IN (${Prisma.join(productIds)})
      GROUP BY v."id", v."product_id"
    ),
    "ranked" AS (
      SELECT
        "id",
        (ROW_NUMBER() OVER (PARTITION BY "product_id" ORDER BY "key" ASC, "id" ASC) - 1)::int AS "pos"
      FROM "keyed"
    )
    UPDATE "svr_variants" v
    SET "position" = "ranked"."pos"
    FROM "ranked"
    WHERE v."id" = "ranked"."id"
      AND v."position" IS DISTINCT FROM "ranked"."pos"
  `
}

/**
 * Re-compose the name of every variant child product of these parents from the
 * option value labels it is built from.
 *
 * shop-variations snapshots a child's name when the matrix is generated, so a
 * label rename leaves "Chair - Oak / Small" behind until something re-composes
 * it. That module does this itself when the rename starts on its own screen;
 * this is the same job in raw SQL for a rename that starts on ours.
 *
 * Slugs are deliberately left alone, matching shop-variations: they are live
 * urls, and the children are hidden from the catalogue anyway. A placed order
 * keeps the name it snapshotted, which is rather the point of that snapshot.
 */
async function syncVariantChildNames(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0
  return prisma.$executeRaw`
    UPDATE "shp_products" child
    SET "name" = composed."name", "updated_at" = CURRENT_TIMESTAMP
    FROM (
      SELECT
        v."child_product_id" AS "id",
        parent."name" || ' - ' || string_agg(ov."label", ' / ' ORDER BY o."position" ASC, ov."position" ASC) AS "name"
      FROM "svr_variants" v
      JOIN "shp_products" parent ON parent."id" = v."product_id"
      JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
      JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
      JOIN "svr_options" o ON o."id" = ov."option_id"
      WHERE v."product_id" IN (${Prisma.join(productIds)})
      GROUP BY v."child_product_id", parent."name"
    ) composed
    WHERE child."id" = composed."id"
      AND child."name" <> composed."name"
  `
}
