import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import type { PatProductAssignments } from '@/modules/product-attributes-for-shop/lib/types'

// Raw assignments for one product id (no variant rollup).
export async function getProductValueIds(productId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ value_id: string }[]>`
    SELECT "value_id" FROM "pat_product_values" WHERE "product_id" = ${productId}
  `
  return rows.map((r) => r.value_id)
}

// A product's own values plus, when shop-variations is installed, the values
// carried by each of its variant child products - keyed by child product id so
// the editor can show them per variant.
export async function getProductAssignments(productId: string): Promise<PatProductAssignments> {
  const own = await getProductValueIds(productId)
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
      prisma.$queryRaw<{ product_id: string; attribute_id: string }[]>`
        SELECT "product_id", "attribute_id" FROM "pat_product_attributes"
        WHERE "product_id" IN (${Prisma.join(productIds)}) AND "show_in_filters" = false
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
// filters (parent's own values unioned with its enabled variants'). Powers the
// counts beside each filter option and the hide-empty-values setting.
export async function countProductsByValue(productIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const effective = await getEffectiveValueIdsByProduct(productIds)
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
