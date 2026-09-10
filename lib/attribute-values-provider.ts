import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// This module's answer to shop's `shop.product-attribute-values` point: a plain
// read of what the owner has ticked against each product, for any module that
// needs to group or label products by an attribute of the owner's own choosing.
//
// Deliberately generic and deliberately read-only. It names no consumer and
// carries no consumer's shape - it says which attributes exist and what each
// product's values are, and what anyone does with that is their business. A
// module that wants one of these attributes stores the ID it was told to use
// and asks here; a shop with this module uninstalled simply has no provider and
// the consumer does without.
//
// Variations are products in their own right in this shop, each with its own
// row, so a variant's own ticks and its parent's both come back through the
// same call - the caller asks for whichever ids it holds.

/** Every attribute the owner has defined, in the order the admin lists them.
 *  Small by nature: a shop with a hundred attributes has a problem no pagination
 *  would fix. */
export async function listAttributesForLabelling(): Promise<Array<{ id: string; name: string }>> {
  return prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name" FROM "pat_attributes" ORDER BY "position" ASC, "name" ASC
  `
}

/** The labels ticked against each of these products for one attribute, keyed by
 *  product id. A product with nothing ticked is absent rather than present and
 *  empty, so a caller can tell "no answer" from "an empty answer". Labels come
 *  back in the attribute's own value order, so a caller taking the first of them
 *  gets the same one on every run. */
export async function productAttributeValues(
  attributeId: string,
  productIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (!attributeId || productIds.length === 0) return result

  const rows = await prisma.$queryRaw<Array<{ product_id: string; label: string }>>`
    SELECT pv."product_id", v."label"
    FROM "pat_product_values" pv
    JOIN "pat_attribute_values" v ON v."id" = pv."value_id"
    WHERE v."attribute_id" = ${attributeId}
      AND pv."product_id" IN (${Prisma.join(productIds)})
    ORDER BY v."position" ASC, v."label" ASC
  `
  for (const row of rows) {
    const labels = result.get(row.product_id) ?? []
    // The same value can be ticked through two helpings of one attribute, which
    // is one answer as far as anybody outside this module is concerned.
    if (!labels.includes(row.label)) labels.push(row.label)
    result.set(row.product_id, labels)
  }
  return result
}

export const productAttributesValuesProvider = {
  listAttributes: listAttributesForLabelling,
  valuesFor: productAttributeValues,
}
