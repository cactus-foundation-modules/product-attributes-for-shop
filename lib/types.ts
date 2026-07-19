// Control type decides how the value is offered on the storefront filter.
// CHECKBOX = tick list, SWATCH = colour dots, DROPDOWN = select,
// IMAGE = picture tiles.
export type PatControlType = 'CHECKBOX' | 'SWATCH' | 'DROPDOWN' | 'IMAGE'

// The `swatch` column holds a hex colour for SWATCH attributes and a media url
// for IMAGE ones - one column, two mediums, because a value has exactly one
// visual whichever control shows it. Urls are long, hence a cap the hex regex
// never needed; the same number shop-variations settled on for the same column.
export const SWATCH_MAX_LENGTH = 1000

export function isHexSwatch(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value)
}

// A picture swatch is either a library url or a site-relative path. Anything
// else - a `javascript:` or `data:` url especially - is refused: this string is
// handed straight to an <img src>, so the validator is the only thing standing
// between the picker and whatever an admin could paste into the API by hand.
export function isImageSwatch(value: string): boolean {
  return value.length <= SWATCH_MAX_LENGTH && (/^https?:\/\//i.test(value) || /^\/[^/]/.test(value))
}

// What either kind of attribute will accept in `swatch`. Deliberately not split
// per control type: an attribute can be switched from colours to pictures and
// back, and refusing to save the value that the other mode left behind would
// make that switch a data-loss trap rather than a change of mind.
export function isValidSwatch(value: string): boolean {
  return isHexSwatch(value) || isImageSwatch(value)
}

// A folder attributes can be sorted into. Admin-side organisation only - the
// storefront filter never reads a group, which is why there is no
// `showInFilters` here to go stale against the attribute's own.
export type PatAttributeGroup = {
  id: string
  name: string
  slug: string
  position: number
}

export type PatAttribute = {
  id: string
  name: string
  slug: string
  controlType: PatControlType
  position: number
  showInFilters: boolean
  // Which folder it sits in, or null for the ungrouped pile. Also decides where
  // its picture swatches are filed in the media library.
  groupId: string | null
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

// One product's assignments, split by where the value is attached. `own` maps an
// assignment id (a single helping of one attribute on this product) to the value
// ids ticked under it; `byVariant` maps a variant child product id to the values
// carried by that variant.
//
// `own` is keyed by assignment rather than flat because a product may use the
// same attribute twice under two names, and the two helpings have to be able to
// hold different ticks - including the same value ticked under both.
export type PatProductAssignments = {
  own: Record<string, string[]>
  byVariant: Record<string, string[]>
}

// A variant of a product as far as this module cares: the child product id it
// maps to and a human label built from its option values.
export type PatVariantRef = {
  childProductId: string
  label: string
  enabled: boolean
}

// One helping of an attribute in a product's set: which attribute, whether its
// value varies per variant, and whether this product's values for it feed the
// public filters.
//
// A product may hold several helpings of the same attribute, each with a
// `nameOverride` heading it (all but one must have one - two blocks with the same
// heading tell the owner nothing). `id` identifies the helping; `attributeId`
// alone no longer does.
export type PatProductAttribute = {
  id: string
  attributeId: string
  nameOverride: string | null
  position: number
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
