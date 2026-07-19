import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { slugify } from '@/modules/shop/lib/slug'
import {
  listVariationOptions,
  getVariantOptionValueMap,
  hasVariationsTables,
  importedValueSlug,
} from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import {
  listAttributes,
  createAttribute,
  createAttributeValue,
  ensureUniqueAttributeSlug,
  nextAttributePosition,
  nextValuePosition,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { clearImportedValuesForProduct } from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { upsertProductAttribute } from '@/modules/product-attributes-for-shop/lib/db/membership'
import type { PatAttributeWithValues, PatControlType } from '@/modules/product-attributes-for-shop/lib/types'
import { isHexSwatch, isImageSwatch, isValidSwatch } from '@/modules/product-attributes-for-shop/lib/types'

export type ImportResult = {
  attributesCreated: number
  valuesCreated: number
  variantsLinked: number
  optionNames: string[]
}

// Turns a product's shop-variations options (Size, Colour) into filterable
// attributes and attaches the values to the individual variants that carry them.
//
// Matching is by option NAME, not id: two products both having a "Colour" option
// should feed one shop-wide "Colour" filter, not one per product. An attribute
// created this way records source_option_name so a later re-import updates it
// rather than making "Colour-2".
//
// Re-importing is idempotent: existing imported assignments for the touched
// attributes are cleared first, so removing a variant in Shop Variations and
// re-importing does not leave a phantom filter match behind.
export async function importVariationOptions(productId: string): Promise<ImportResult> {
  const empty: ImportResult = { attributesCreated: 0, valuesCreated: 0, variantsLinked: 0, optionNames: [] }
  if (!(await hasVariationsTables())) return empty

  const options = await listVariationOptions(productId)
  if (options.length === 0) return empty

  const existing = await listAttributes()
  let attributesCreated = 0
  let valuesCreated = 0

  // option value id -> attribute value id, so variants can be linked below, plus
  // which attribute each of those values belongs to, so the link can be filed
  // under the right helping.
  const optionValueToAttributeValue = new Map<string, string>()
  const attributeIdOfValue = new Map<string, string>()
  const touchedAttributeIds: string[] = []

  for (const option of options) {
    // Prefer an attribute already imported from this option name, else any
    // attribute the owner happens to have named the same thing (case-insensitive).
    let attribute: PatAttributeWithValues | undefined =
      existing.find((a) => a.sourceOptionName?.toLowerCase() === option.name.toLowerCase()) ??
      existing.find((a) => a.name.toLowerCase() === option.name.toLowerCase())

    if (!attribute) {
      const slug = await ensureUniqueAttributeSlug(slugify(option.name) || 'attribute')
      // Pictures win over colours when an option carries both: shop-variations
      // keeps either in the same column, and a filter showing colour dots for the
      // values that happen to have one is a worse guess than picture tiles with
      // an empty tile or two.
      const controlType: PatControlType = option.values.some((v) => v.swatch && isImageSwatch(v.swatch))
        ? 'IMAGE'
        : option.values.some((v) => v.swatch && isHexSwatch(v.swatch))
          ? 'SWATCH'
          : 'CHECKBOX'
      const position = await nextAttributePosition()
      const created = await createAttribute({ name: option.name, slug, controlType, position, sourceOptionName: option.name })
      attribute = {
        id: created.id,
        name: option.name,
        slug,
        controlType,
        position,
        showInFilters: true,
        // Imported attributes land ungrouped: the variation option they came from
        // says nothing about which folder the owner would want them filed in.
        groupId: null,
        sourceOptionName: option.name,
        values: [],
      }
      existing.push(attribute)
      attributesCreated++
    }
    touchedAttributeIds.push(attribute.id)

    for (const value of option.values) {
      const slug = importedValueSlug(value.label)
      let match = attribute.values.find((v) => v.slug === slug || v.label.toLowerCase() === value.label.toLowerCase())
      if (!match) {
        // Hex colours and picture urls both come across now that IMAGE exists.
        // Anything else shop-variations may hold there - a bare media id, say -
        // is still dropped: there is nothing this module could render from it.
        const swatch = value.swatch && isValidSwatch(value.swatch) ? value.swatch : null
        const position = await nextValuePosition(attribute.id)
        const created = await createAttributeValue({ attributeId: attribute.id, label: value.label, slug, swatch, position })
        match = { id: created.id, attributeId: attribute.id, label: value.label, slug, swatch, position }
        attribute.values.push(match)
        valuesCreated++
      }
      optionValueToAttributeValue.set(value.id, match.id)
      attributeIdOfValue.set(match.id, attribute.id)
    }
  }

  // Bring each imported attribute into the product's set and mark it used for
  // variations, so it shows as a column on the Variations tab where its per-
  // variant values were just linked. Existing rows keep their show_in_filters.
  //
  // The id each one lands on is kept: a per-variant value is filed against the
  // helping that owns its column, not against the attribute, so that a product
  // using one attribute for two columns can tell its two answers apart.
  const assignmentByAttribute = new Map<string, string>()
  for (const attributeId of touchedAttributeIds) {
    const assignmentId = await upsertProductAttribute(productId, { attributeId, useForVariations: true, showInFilters: true })
    if (assignmentId) assignmentByAttribute.set(attributeId, assignmentId)
  }

  // Wipe previous imported assignments for these attributes before re-linking.
  await clearImportedValuesForProduct(productId, touchedAttributeIds)

  const variantMap = await getVariantOptionValueMap(productId)
  const rows: { productId: string; valueId: string; assignmentId: string }[] = []
  for (const [childProductId, optionValueIds] of variantMap) {
    for (const optionValueId of optionValueIds) {
      const valueId = optionValueToAttributeValue.get(optionValueId)
      if (!valueId) continue
      const assignmentId = assignmentByAttribute.get(attributeIdOfValue.get(valueId) ?? '')
      if (!assignmentId) continue
      rows.push({ productId: childProductId, valueId, assignmentId })
    }
  }

  if (rows.length > 0) {
    await prisma.$executeRaw`
      INSERT INTO "pat_product_values" ("product_id", "value_id", "assignment_id")
      VALUES ${Prisma.join(rows.map((r) => Prisma.sql`(${r.productId}, ${r.valueId}, ${r.assignmentId})`))}
      ON CONFLICT DO NOTHING
    `
  }

  return {
    attributesCreated,
    valuesCreated,
    variantsLinked: variantMap.size,
    optionNames: options.map((o) => o.name),
  }
}
