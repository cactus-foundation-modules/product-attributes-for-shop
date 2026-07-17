// Control type decides how the value is offered on the storefront filter.
// CHECKBOX = tick list, SWATCH = colour dots, DROPDOWN = select.
export type PatControlType = 'CHECKBOX' | 'SWATCH' | 'DROPDOWN'

export type PatAttribute = {
  id: string
  name: string
  slug: string
  controlType: PatControlType
  position: number
  showInFilters: boolean
  // The shop-variations option name this was imported from, if any. A re-import
  // updates the matching attribute rather than making a second one.
  sourceOptionName: string | null
}

export type PatAttributeValue = {
  id: string
  attributeId: string
  label: string
  slug: string
  swatch: string | null
  position: number
}

export type PatAttributeWithValues = PatAttribute & { values: PatAttributeValue[] }

// One product's assignments, split by where the value is attached. `own` are
// values on the product itself; `byVariant` maps a variant child product id to
// the values carried by that variant.
export type PatProductAssignments = {
  own: string[]
  byVariant: Record<string, string[]>
}

// A variant of a product as far as this module cares: the child product id it
// maps to and a human label built from its option values.
export type PatVariantRef = {
  childProductId: string
  label: string
  enabled: boolean
}

// One attribute in a product's set: which attribute, whether its value varies per
// variant, and whether this product's values for it feed the public filters.
export type PatProductAttribute = {
  attributeId: string
  useForVariations: boolean
  showInFilters: boolean
}

// A "use for variations" attribute as the Variations-tab column needs it: the
// attribute and its selectable values, in display order.
export type PatVariationColumn = {
  attributeId: string
  name: string
  position: number
  values: { id: string; label: string; swatch: string | null }[]
}
