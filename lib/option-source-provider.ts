import {
  listAttributes,
  createAttributeValue,
  findAttributeValueByLabel,
  getAttribute,
  getAttributeValue,
  ensureUniqueValueSlug,
  nextValuePosition,
} from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { listAttributeGroups } from '@/modules/product-attributes-for-shop/lib/db/groups'
import { slugify } from '@/modules/shop/lib/slug'
import { fileSwatchImage } from '@/modules/product-attributes-for-shop/lib/media-folder'
import { isImageSwatch, isValidSwatch } from '@/modules/product-attributes-for-shop/lib/types'

// Offers this module's attributes to shop-variations as ready-made product
// options, through the `shop-variations.option-source` point. An owner who has
// already set up a Colour attribute with twelve values should not have to type
// those twelve out again on every product that comes in twelve colours.
//
// shop-variations is an OPTIONAL companion (see variations-bridge.ts), so the
// types below are declared locally and structurally rather than imported from
// '@/modules/shop-variations/...' - that path does not exist on an install
// without the module, and a static import would break the build there. The
// extension point simply never fires when the module is absent.
//
// Nothing is copied by reference: shop-variations takes its own copy of the
// labels and swatches and owns them from then on. What the refs below buy is the
// ability to come back later and re-read the attribute - which value is which
// survives a rename, because the match is on id rather than label.

type OptionSourceValue = { ref: string; label: string; swatch: string | null }
type OptionSource = { ref: string; name: string; groupLabel?: string | null; values: OptionSourceValue[] }

// A value with no label is not offerable - it would create a nameless option
// value and, downstream, a nameless variant.
function toSource(
  attribute: { id: string; name: string; groupId: string | null; values: { id: string; label: string; swatch: string | null }[] },
  groupNames: Map<string, string>,
): OptionSource {
  return {
    ref: attribute.id,
    name: attribute.name,
    groupLabel: attribute.groupId ? groupNames.get(attribute.groupId) ?? null : null,
    values: attribute.values
      .filter((v) => v.label.trim().length > 0)
      .map((v) => ({ ref: v.id, label: v.label, swatch: v.swatch })),
  }
}

async function groupNameMap(): Promise<Map<string, string>> {
  const groups = await listAttributeGroups()
  return new Map(groups.map((g) => [g.id, g.name]))
}

export const productAttributesOptionSourceProvider = {
  label: 'Attributes',

  // Every attribute, grouped as they are on the attributes screen. Attributes
  // hidden from the public filters are still offered: whether a shopper can
  // filter by Colour has no bearing on whether a product can be sold in colours.
  async listSources(): Promise<OptionSource[]> {
    const [attributes, groupNames] = await Promise.all([listAttributes(), groupNameMap()])
    return attributes.map((a) => toSource(a, groupNames))
  },

  // One attribute, for a refresh. Null once it has been deleted, which the
  // caller reports rather than treating as an empty list - "this attribute is
  // gone" and "this attribute has no values" deserve different words.
  async getSource(ref: string): Promise<OptionSource | null> {
    const [attributes, groupNames] = await Promise.all([listAttributes(), groupNameMap()])
    const match = attributes.find((a) => a.id === ref)
    return match ? toSource(match, groupNames) : null
  },

  // Add a value to the attribute itself, for a value typed on a product's
  // Variations tab. The traffic used to run one way only - attributes fed
  // products - which meant a colour first met on a product never made it back to
  // the list every other product picks from, and had to be typed a second time
  // on the attributes screen to become reusable.
  //
  // Same reuse-by-label rule the values POST route applies with `reuseExisting`:
  // an attribute already carrying "Oak" hands that value's ref back rather than
  // making a second "Oak", so two products end up pointing at one value.
  //
  // Null when the attribute has gone (deleted between the page loading and the
  // value being typed), which the caller reports rather than papering over.
  async createValue(ref: string, input: { label: string; swatch: string | null }): Promise<OptionSourceValue | null> {
    const attribute = await getAttribute(ref)
    if (!attribute) return null

    const label = input.label.trim()
    if (!label) return null

    const existing = await findAttributeValueByLabel(ref, label)
    if (existing) return { ref: existing.id, label: existing.label, swatch: existing.swatch }

    // A swatch the attributes screen would refuse is dropped rather than stored:
    // this string ends up in an <img src>, and a value with no swatch is a far
    // smaller problem than one with a swatch nobody vetted.
    const swatch = input.swatch && isValidSwatch(input.swatch) ? input.swatch : null
    const slug = await ensureUniqueValueSlug(ref, slugify(label) || 'value')
    const position = await nextValuePosition(ref)
    const created = await createAttributeValue({ attributeId: ref, label, slug, swatch, swatchSize: null, position })

    // Filing a picture rewrites its url (the library keys blobs by folder), so
    // the row is re-read rather than echoing what came in - otherwise the copy
    // taken downstream would point at the pre-move url and 404.
    let stored = swatch
    if (swatch && isImageSwatch(swatch)) {
      await fileSwatchImage(ref, created.id, swatch)
      stored = (await getAttributeValue(created.id))?.swatch ?? swatch
    }

    return { ref: created.id, label, swatch: stored }
  },
}
