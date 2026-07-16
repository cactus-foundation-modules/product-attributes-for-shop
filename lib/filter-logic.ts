// The storefront filter's matching rule, kept pure and away from the React
// component so it can be tested without a DOM or a database.
//
// Facet semantics: values within one attribute are OR'd (Red or Blue), separate
// attributes are AND'd (Red AND Oak). Matches how every high-street shop filter
// behaves, so it needs no explaining to a shopper.
//
// `selected` maps an attribute id to the value ids ticked under it. An attribute
// with nothing ticked places no constraint at all.
export function matchesSelection(valueIds: readonly string[], selected: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  for (const chosen of selected.values()) {
    if (chosen.size === 0) continue
    let hit = false
    for (const valueId of chosen) {
      if (valueIds.includes(valueId)) { hit = true; break }
    }
    if (!hit) return false
  }
  return true
}
