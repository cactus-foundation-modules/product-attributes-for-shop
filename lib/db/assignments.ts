import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import type { PatProductAssignments } from '@/modules/product-attributes-for-shop/lib/types'

// Raw assignments for one product id (no variant rollup), flat.
export async function getProductValueIds(productId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ value_id: string }[]>`
    SELECT DISTINCT "value_id" FROM "pat_product_values" WHERE "product_id" = ${productId}
  `
  return rows.map((r) => r.value_id)
}

// The same rows grouped by the helping they were ticked under, which is what the
// editor renders: one block per helping, each with its own ticks. Rows with no
// assignment (values on a variant child, or written before helpings existed)
// are not product-level ticks and never appear here.
export async function getProductValueIdsByAssignment(productId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.$queryRaw<{ assignment_id: string; value_id: string }[]>`
    SELECT "assignment_id", "value_id" FROM "pat_product_values"
    WHERE "product_id" = ${productId} AND "assignment_id" IS NOT NULL
  `
  const byAssignment: Record<string, string[]> = {}
  for (const row of rows) (byAssignment[row.assignment_id] ??= []).push(row.value_id)
  return byAssignment
}

// A product's own values plus, when shop-variations is installed, the values
// carried by each of its variant child products - keyed by child product id so
// the editor can show them per variant.
export async function getProductAssignments(productId: string): Promise<PatProductAssignments> {
  const own = await getProductValueIdsByAssignment(productId)
  if (!(await hasVariationsTables())) return { own, byVariant: {} }

  const rows = await prisma.$queryRaw<{ child_product_id: string; value_id: string }[]>`
    SELECT v."child_product_id", pv."value_id"
    FROM "svr_variants" v
    JOIN "pat_product_values" pv ON pv."product_id" = v."child_product_id"
    WHERE v."product_id" = ${productId}
  `
  const byVariant: Record<string, string[]> = {}
  for (const row of rows) {
    ;(byVariant[row.child_product_id] ??= []).push(row.value_id)
  }
  return { own, byVariant }
}

// Replaces every assignment for a single product id in one go. Used for both the
// parent product and an individual variant child - they are the same shape of
// row, which is exactly why per-variant attributes need no second table.
export async function setProductValueIds(productId: string, valueIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "pat_product_values" WHERE "product_id" = ${productId}`
    if (valueIds.length === 0) return
    await tx.$executeRaw`
      INSERT INTO "pat_product_values" ("product_id", "value_id")
      SELECT ${productId}, v."id" FROM "pat_attribute_values" v
      WHERE v."id" IN (${Prisma.join(valueIds)})
      ON CONFLICT DO NOTHING
    `
  })
}

/**
 * Replaces every product-level tick on a product, grouped by the helping each
 * one was ticked under.
 *
 * Only rows carrying an assignment are cleared: the ones without belong to a
 * variant child product, and those are written on the Variations tab. A value
 * whose attribute is not the one its helping names is dropped by the join, so a
 * crafted request cannot file "Oak" under the Colour block.
 */
export async function setProductValueIdsByAssignment(
  productId: string,
  byAssignment: Record<string, string[]>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "pat_product_values"
      WHERE "product_id" = ${productId} AND "assignment_id" IS NOT NULL
    `
    for (const [assignmentId, valueIds] of Object.entries(byAssignment)) {
      if (!assignmentId || valueIds.length === 0) continue
      await tx.$executeRaw`
        INSERT INTO "pat_product_values" ("product_id", "value_id", "assignment_id")
        SELECT ${productId}, v."id", ppa."id"
        FROM "pat_attribute_values" v
        JOIN "pat_product_attributes" ppa
          ON ppa."id" = ${assignmentId}
         AND ppa."product_id" = ${productId}
         AND ppa."attribute_id" = v."attribute_id"
        WHERE v."id" IN (${Prisma.join(valueIds)})
        ON CONFLICT DO NOTHING
      `
    }
  })
}

// Each product's product-level ticks resolved to labels, keyed product id ->
// assignment id -> the labels ticked under it. Only NON use-for-variations
// helpings are read (those are the Products-tab columns); a variation helping's
// values live on the variant children and belong to the Variations tab. Powers
// the Google-Sheet Products tab's attribute columns on Push.
export async function getProductOwnValuesByAssignment(
  productIds: string[],
): Promise<Record<string, Record<string, string[]>>> {
  const result: Record<string, Record<string, string[]>> = {}
  if (productIds.length === 0) return result
  const rows = await prisma.$queryRaw<{ product_id: string; assignment_id: string; label: string }[]>`
    SELECT pv."product_id", pv."assignment_id", av."label"
    FROM "pat_product_values" pv
    JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
    JOIN "pat_product_attributes" ppa
      ON ppa."id" = pv."assignment_id" AND ppa."use_for_variations" = false
    WHERE pv."product_id" IN (${Prisma.join(productIds)})
    ORDER BY av."position" ASC, av."label" ASC
  `
  for (const r of rows) {
    ;((result[r.product_id] ??= {})[r.assignment_id] ??= []).push(r.label)
  }
  return result
}

// The same product-level ticks as value IDS rather than labels, for the import to
// diff a sheet cell against what is stored without re-resolving each label. Keyed
// product id -> assignment id -> the value ids ticked.
export async function getProductOwnValueIdsByAssignment(
  productIds: string[],
): Promise<Record<string, Record<string, string[]>>> {
  const result: Record<string, Record<string, string[]>> = {}
  if (productIds.length === 0) return result
  const rows = await prisma.$queryRaw<{ product_id: string; assignment_id: string; value_id: string }[]>`
    SELECT pv."product_id", pv."assignment_id", pv."value_id"
    FROM "pat_product_values" pv
    JOIN "pat_product_attributes" ppa
      ON ppa."id" = pv."assignment_id" AND ppa."use_for_variations" = false
    WHERE pv."product_id" IN (${Prisma.join(productIds)})
  `
  for (const r of rows) {
    ;((result[r.product_id] ??= {})[r.assignment_id] ??= []).push(r.value_id)
  }
  return result
}

// Replaces one product-level helping's ticks in place, leaving every other helping
// on the product untouched - unlike setProductValueIdsByAssignment, which rewrites
// the product's whole product-level set. A Pull edits one attribute column at a
// time and a partial sheet must not clear the columns it does not carry, so the
// write has to be scoped to the single assignment. The attribute join is the
// guard: a value belonging to another attribute writes no row.
export async function setProductAssignmentValues(
  productId: string,
  assignmentId: string,
  valueIds: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "pat_product_values"
      WHERE "product_id" = ${productId} AND "assignment_id" = ${assignmentId}
    `
    if (valueIds.length === 0) return
    await tx.$executeRaw`
      INSERT INTO "pat_product_values" ("product_id", "value_id", "assignment_id")
      SELECT ${productId}, v."id", ppa."id"
      FROM "pat_attribute_values" v
      JOIN "pat_product_attributes" ppa
        ON ppa."id" = ${assignmentId}
       AND ppa."product_id" = ${productId}
       AND ppa."attribute_id" = v."attribute_id"
      WHERE v."id" IN (${Prisma.join(valueIds)})
      ON CONFLICT DO NOTHING
    `
  })
}

// The effective value ids for each of the given parent products: the product's
// own values unioned with those of its enabled variant children. This is what
// the storefront filter matches against, so a parent with a red variant is
// findable under "Colour: Red" even though the parent itself carries no colour.
//
// Disabled variants are excluded - a switched-off variant is not buyable, so
// letting it drag its parent into a filter result would be a dead end.
export async function getEffectiveValueIdsByProduct(
  productIds: string[],
  opts?: { includeVariantValues?: boolean },
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (productIds.length === 0) return result

  const ownRows = await prisma.$queryRaw<{ product_id: string; value_id: string }[]>`
    SELECT "product_id", "value_id" FROM "pat_product_values"
    WHERE "product_id" IN (${Prisma.join(productIds)})
  `
  for (const row of ownRows) {
    const list = result.get(row.product_id) ?? []
    list.push(row.value_id)
    result.set(row.product_id, list)
  }

  const includeVariants = opts?.includeVariantValues ?? true
  if (includeVariants && (await hasVariationsTables())) {
    const variantRows = await prisma.$queryRaw<{ product_id: string; value_id: string }[]>`
      SELECT v."product_id", pv."value_id"
      FROM "svr_variants" v
      JOIN "pat_product_values" pv ON pv."product_id" = v."child_product_id"
      WHERE v."product_id" IN (${Prisma.join(productIds)}) AND v."enabled" = true
    `
    for (const row of variantRows) {
      const list = result.get(row.product_id) ?? []
      if (!list.includes(row.value_id)) list.push(row.value_id)
      result.set(row.product_id, list)
    }
  }

  // Per-product hiding: a value whose attribute this product has marked out of the
  // filters does not contribute to the public grid, even though it stays assigned
  // (e.g. an attribute used only to organise variants). This is narrower than the
  // shop-wide pat_attributes.show_in_filters, which drops the attribute for the
  // whole catalogue; both are honoured.
  const allValueIds = [...new Set([...result.values()].flat())]
  if (allValueIds.length > 0) {
    const [attrOfValue, hiddenRows] = await Promise.all([
      prisma.$queryRaw<{ id: string; attribute_id: string }[]>`
        SELECT "id", "attribute_id" FROM "pat_attribute_values" WHERE "id" IN (${Prisma.join(allValueIds)})
      `,
      // Grouped, because a product can hold the same attribute more than once
      // under different names. One helping being hidden must not drag a value
      // the other one shows out of the filters, so this only counts an attribute
      // as hidden when every helping of it on that product is.
      prisma.$queryRaw<{ product_id: string; attribute_id: string }[]>`
        SELECT "product_id", "attribute_id" FROM "pat_product_attributes"
        WHERE "product_id" IN (${Prisma.join(productIds)})
        GROUP BY "product_id", "attribute_id"
        HAVING bool_or("show_in_filters") = false
      `,
    ])
    if (hiddenRows.length > 0) {
      const attributeOf = new Map(attrOfValue.map((r) => [r.id, r.attribute_id]))
      const hidden = new Set(hiddenRows.map((r) => `${r.product_id}:${r.attribute_id}`))
      for (const [productId, valueIds] of result) {
        result.set(productId, valueIds.filter((v) => !hidden.has(`${productId}:${attributeOf.get(v) ?? ''}`)))
      }
    }
  }

  return result
}

// How many products carry each value, counted the same way the storefront
// filters. Powers the counts beside each filter option and the hide-empty-values
// setting, so it MUST see products exactly as the matrix does: passed the same
// includeVariantValues the grid builds its matrix with. Left to its own devices
// it rolled variants up regardless, so with the setting off a variant-only value
// showed a non-zero count, survived hide-empty-values, and then matched nothing
// when ticked - a dead-end filter option.
export async function countProductsByValue(
  productIds: string[],
  opts?: { includeVariantValues?: boolean },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const effective = await getEffectiveValueIdsByProduct(productIds, opts)
  for (const valueIds of effective.values()) {
    for (const valueId of valueIds) counts.set(valueId, (counts.get(valueId) ?? 0) + 1)
  }
  return counts
}

// Clears every assignment for a product and its variant children. Used before a
// re-import so stale imported values do not linger.
export async function clearImportedValuesForProduct(productId: string, attributeIds: string[]): Promise<void> {
  if (attributeIds.length === 0) return
  const variantsInstalled = await hasVariationsTables()
  const scope = variantsInstalled
    ? Prisma.sql`("product_id" = ${productId} OR "product_id" IN (
        SELECT "child_product_id" FROM "svr_variants" WHERE "product_id" = ${productId}
      ))`
    : Prisma.sql`"product_id" = ${productId}`

  await prisma.$executeRaw`
    DELETE FROM "pat_product_values"
    WHERE ${scope}
      AND "value_id" IN (
        SELECT "id" FROM "pat_attribute_values" WHERE "attribute_id" IN (${Prisma.join(attributeIds)})
      )
  `
}
