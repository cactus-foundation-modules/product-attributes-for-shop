import { prisma } from '@/lib/db/prisma'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

// Who actually uses one attribute value. Asked by the admin screen's "i" button,
// and the reason it exists at all: a vocabulary that has drifted into two
// near-identical values ("Black" and "Black") can only be tidied once you can see
// which products hang off each of them.
//
// Usage arrives by TWO routes, and counting only the first is how a value that
// holds up a hundred products reads as unused:
//
//   1. pat_product_values - the value ticked on a product, or on one of the
//      hidden child products a variation is.
//   2. svr_option_values.source_ref - a variation option value COPIED from this
//      attribute value by the variations bridge. The copy is what the variants
//      are actually built from, and nothing in pat_product_values records it.

export type PatValueUsageVariant = {
  /** The hidden child product the variant is, not the svr_variants row. */
  id: string
  name: string
  status: string
}

export type PatValueUsageOption = {
  /** What the variations option is called on this product, e.g. "Finish". */
  optionName: string
  /** The copied option value's label, which can differ after a local rename. */
  label: string
  /** How many of the product's variations are built from that copy. */
  variantRows: number
}

export type PatValueUsageProduct = {
  id: string
  name: string
  status: string
  /** The product itself carries the value, rather than only its variants. */
  direct: boolean
  variants: PatValueUsageVariant[]
  /** Variation options on this product copied from the value. */
  options: PatValueUsageOption[]
}

export type PatValueUsage = {
  products: PatValueUsageProduct[]
  /** Rows in pat_product_values, parents and variant children together. */
  totalRows: number
  /** Variation option values copied from this attribute value. */
  totalOptionValues: number
  /** Variations built from those copies. */
  totalVariantRows: number
  /** True when the ticked-value query stopped at ROW_LIMIT, so that list is partial. */
  truncated: boolean
}

export type PatValueSummary = {
  id: string
  label: string
  slug: string
  swatch: string | null
  attributeId: string
  attributeName: string
  attributeSlug: string
}

// A value that has been ticked on every variant of a large range runs to a few
// thousand rows. Enough to draw the picture; the counts above it are the honest
// totals either way.
const ROW_LIMIT = 5000

export async function getValueSummary(valueId: string): Promise<PatValueSummary | null> {
  const rows = await prisma.$queryRaw<
    { id: string; label: string; slug: string; swatch: string | null; attribute_id: string; attribute_name: string; attribute_slug: string }[]
  >`
    SELECT v."id", v."label", v."slug", v."swatch",
           a."id" AS "attribute_id", a."name" AS "attribute_name", a."slug" AS "attribute_slug"
    FROM "pat_attribute_values" v
    JOIN "pat_attributes" a ON a."id" = v."attribute_id"
    WHERE v."id" = ${valueId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    label: row.label,
    slug: row.slug,
    swatch: row.swatch ?? null,
    attributeId: row.attribute_id,
    attributeName: row.attribute_name,
    attributeSlug: row.attribute_slug,
  }
}

type TickedRow = {
  product_id: string
  product_name: string
  product_status: string
  parent_id: string | null
  parent_name: string | null
  parent_status: string | null
}

type OptionRow = {
  product_id: string
  product_name: string
  product_status: string
  option_name: string
  label: string
  variant_rows: bigint
}

// Variant children are rolled up onto the product they belong to: "Elev8 Desk
// (3 variations)" is what an owner is after, not three hundred hidden child
// products with the range name repeated on each of them.
export async function getValueUsage(valueId: string): Promise<PatValueUsage> {
  const withVariations = await hasVariationsTables()

  const countRows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT count(*)::bigint AS "count" FROM "pat_product_values" WHERE "value_id" = ${valueId}
  `
  const totalRows = Number(countRows[0]?.count ?? 0)

  // Two queries rather than one with a conditional join: shop-variations is an
  // optional companion, and svr_variants simply does not exist on an install
  // without it - see variations-bridge for why this module never imports from it.
  const tickedRows = withVariations
    ? await prisma.$queryRaw<TickedRow[]>`
        SELECT p."id" AS "product_id", p."name" AS "product_name", p."status" AS "product_status",
               v."product_id" AS "parent_id", pp."name" AS "parent_name", pp."status" AS "parent_status"
        FROM "pat_product_values" pv
        JOIN "shp_products" p ON p."id" = pv."product_id"
        LEFT JOIN "svr_variants" v ON v."child_product_id" = p."id"
        LEFT JOIN "shp_products" pp ON pp."id" = v."product_id"
        WHERE pv."value_id" = ${valueId}
        ORDER BY COALESCE(pp."name", p."name") ASC, p."name" ASC
        LIMIT ${ROW_LIMIT}
      `
    : await prisma.$queryRaw<TickedRow[]>`
        SELECT p."id" AS "product_id", p."name" AS "product_name", p."status" AS "product_status",
               NULL::text AS "parent_id", NULL::text AS "parent_name", NULL::text AS "parent_status"
        FROM "pat_product_values" pv
        JOIN "shp_products" p ON p."id" = pv."product_id"
        WHERE pv."value_id" = ${valueId}
        ORDER BY p."name" ASC
        LIMIT ${ROW_LIMIT}
      `

  const optionRows = withVariations
    ? await prisma.$queryRaw<OptionRow[]>`
        SELECT o."product_id" AS "product_id", p."name" AS "product_name", p."status" AS "product_status",
               o."name" AS "option_name", ov."label" AS "label",
               (SELECT count(*)::bigint FROM "svr_variant_values" vv WHERE vv."option_value_id" = ov."id") AS "variant_rows"
        FROM "svr_option_values" ov
        JOIN "svr_options" o ON o."id" = ov."option_id"
        JOIN "shp_products" p ON p."id" = o."product_id"
        WHERE ov."source_ref" = ${valueId}
        ORDER BY p."name" ASC, o."name" ASC
      `
    : []

  const byProduct = new Map<string, PatValueUsageProduct>()
  const entryFor = (id: string, name: string, status: string): PatValueUsageProduct => {
    let entry = byProduct.get(id)
    if (!entry) {
      entry = { id, name, status, direct: false, variants: [], options: [] }
      byProduct.set(id, entry)
    }
    return entry
  }

  for (const row of tickedRows) {
    if (row.parent_id) {
      const entry = entryFor(row.parent_id, row.parent_name ?? row.product_name, row.parent_status ?? row.product_status)
      entry.variants.push({ id: row.product_id, name: row.product_name, status: row.product_status })
    } else {
      entryFor(row.product_id, row.product_name, row.product_status).direct = true
    }
  }

  let totalVariantRows = 0
  for (const row of optionRows) {
    const variantRows = Number(row.variant_rows)
    totalVariantRows += variantRows
    entryFor(row.product_id, row.product_name, row.product_status).options.push({
      optionName: row.option_name,
      label: row.label,
      variantRows,
    })
  }

  const products = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name))

  return {
    products,
    totalRows,
    totalOptionValues: optionRows.length,
    totalVariantRows,
    truncated: tickedRows.length >= ROW_LIMIT,
  }
}

// How many products each value holds up, for every value at once - the number the
// attributes screen prints on the chip. Counted the same way the usage page's
// headline is: variant children roll up to the parent product, and a variation
// option copied from the value counts its product too, so the chip and the page
// it opens never disagree.
//
// One query for the whole screen rather than one per chip: a Colour attribute
// alone runs to several hundred values.
export async function countProductsPerValue(): Promise<Record<string, number>> {
  const withVariations = await hasVariationsTables()

  // UNION, not UNION ALL: a product that both ticks the value and offers it as a
  // variation option is one product, not two.
  const rows = withVariations
    ? await prisma.$queryRaw<{ value_id: string; count: bigint }[]>`
        SELECT "value_id", count(*)::bigint AS "count" FROM (
          SELECT pv."value_id" AS "value_id", COALESCE(v."product_id", pv."product_id") AS "product_id"
          FROM "pat_product_values" pv
          JOIN "shp_products" p ON p."id" = pv."product_id"
          LEFT JOIN "svr_variants" v ON v."child_product_id" = pv."product_id"
          UNION
          SELECT ov."source_ref" AS "value_id", o."product_id" AS "product_id"
          FROM "svr_option_values" ov
          JOIN "svr_options" o ON o."id" = ov."option_id"
          JOIN "shp_products" p ON p."id" = o."product_id"
          WHERE ov."source_ref" IS NOT NULL
        ) "pairs"
        GROUP BY "value_id"
      `
    : await prisma.$queryRaw<{ value_id: string; count: bigint }[]>`
        SELECT pv."value_id" AS "value_id", count(DISTINCT pv."product_id")::bigint AS "count"
        FROM "pat_product_values" pv
        JOIN "shp_products" p ON p."id" = pv."product_id"
        GROUP BY pv."value_id"
      `

  const out: Record<string, number> = {}
  for (const row of rows) out[row.value_id] = Number(row.count)
  return out
}
