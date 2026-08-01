'use client'

// The Specification tab's body on the product page, when this module has taken
// it over for a product (shop's lib/detail-spec.ts). Shop's own SKU/Type/Weight/
// Dimensions facts give way to the product's own attributes, sorted into the
// headed sections the owner built on the Attributes tab.
//
// A client component because shop hands a replaced panel down through the RSC
// boundary as a prop, and a server component cannot be passed that way (see
// shop's lib/detail-spec.ts). The spec itself was resolved while the page
// rendered, so the first HTML is complete and a crawler or a visitor without
// JavaScript reads the whole table.
//
// What the browser adds is which variation the shopper has landed on. A chair's
// seat height, weight and mechanisms change with the options picked, so once a
// full combination is chosen the table stops describing the range and starts
// describing the actual chair - and says so.
//
// The selection arrives on a plain window event, NOT an import: shop-variations
// may not be installed, and '@/modules/shop-variations/...' does not exist on
// such an install, so a static import would break the build there. The event
// name, the window snapshot and the detail shape below are copies of that
// module's documented seam (its lib/selection-broadcast.ts), duplicated on
// purpose.

import { useEffect, useState } from 'react'
import type { PatSpecPanelPayload } from '@/modules/product-attributes-for-shop/lib/db/spec-view'
import { DEFAULT_BREAKPOINTS, type Breakpoints } from '@/modules/shop/lib/breakpoints-shared'

const VARIANT_SELECTION_EVENT = 'cactus-shop-variant-selection'

type VariantSelectionDetail = {
  slug: string
  parentProductId: string | null
  // The resolved variation's own product, null until every option is chosen.
  productId: string | null
  allOptionsChosen: boolean
}

function readSnapshot(): VariantSelectionDetail | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & { __cactusVariantSelection?: VariantSelectionDetail }
  return w.__cactusVariantSelection ?? null
}

// Class names are this module's own; the colours are the site's tokens, so the
// table sits in shop's Specification panel looking like it belongs there in both
// light and dark.
//
// The groups fill CSS multi-columns rather than a grid: a grid's rows all take
// the height of their tallest group, leaving a well of whitespace under every
// short one. Columns stack the boxes tightly - each group starts where the one
// above it ends - and the browser balances the column bottoms itself, which also
// means the layout re-settles for free when a chosen variation drops rows out of
// the table client-side. `break-inside:avoid` keeps a group whole rather than
// letting a column boundary saw it in half.
//
// The 16px rhythm between groups is PADDING on a wrapper, never a margin on the
// bordered box itself. A margin left sitting at a column break is dangling, and
// engines disagree about what to do with it: WebKit carries it to the TOP of
// the next column, so the first group of column three sat 16px lower than the
// other two columns, while Blink put it at zero (measured on the live page at
// every desktop width, before and after). Padding belongs to the wrapper's own
// box, which `break-inside:avoid` keeps whole, so there is no stray edge left
// at a boundary for either engine to place.
//
// Three columns on desktop, two on tablet and one on mobile, collapsing at the
// site's own Styles > Spacing & Breakpoints widths (handed in by
// lib/detail-spec-provider.ts) rather than at bespoke pixels.
//
// The "Your choice" pill is a deliberate copy of shop-variations'
// YourChoicePill (its components/public/VariantParts.tsx) so the spec table and
// the gallery stage wear the same badge - copied, not imported, because that
// module may not be installed and '@/modules/shop-variations/...' would break
// the build on such a site (same bargain as the selection event above). Static
// here rather than absolute: it leads the table instead of floating over it.
const specCss = ({ tabletBp, mobileBp }: Breakpoints) => `
.pat-spec-choice{display:inline-flex;align-items:center;gap:.375rem;margin-bottom:16px;
  padding:5px 10px;border-radius:999px;
  background:var(--color-primary);color:var(--color-on-primary);
  font-size:.6875rem;font-weight:700;letter-spacing:.02em;line-height:1}
.pat-spec-cols{columns:3;column-gap:16px}
.pat-spec-item{break-inside:avoid;padding-bottom:16px}
.pat-spec-group{break-inside:avoid;margin:0;border:1px solid var(--color-border);border-radius:12px;overflow:hidden}
.pat-spec-head{font-weight:600;font-size:15px;padding:12px 16px;background:var(--color-bg-subtle);
  border-bottom:1px solid var(--color-border);color:var(--color-text)}
.pat-spec-table{width:100%;border-collapse:collapse}
.pat-spec-table tr+tr td{border-top:1px solid var(--color-border)}
.pat-spec-table td{padding:12px 16px;font-size:14px;vertical-align:top;line-height:1.4}
.pat-spec-table td:first-child{color:var(--color-text-muted);width:40%;padding-right:24px}
.pat-spec-table td:last-child{color:var(--color-text);font-weight:500}
@media (max-width:${tabletBp}){.pat-spec-cols{columns:2}}
@media (max-width:${mobileBp}){.pat-spec-cols{columns:1}}
`

export function SpecificationPanel({ payload, autoSort }: { payload: unknown; autoSort?: boolean }) {
  const view = payload as PatSpecPanelPayload
  const [variantId, setVariantId] = useState<string | null>(null)

  // Post-mount only, and deliberately so: the server rendered the range, and
  // seeding the chosen variation during the first render would mismatch it.
  useEffect(() => {
    const parentProductId = view?.parentProductId
    if (!parentProductId) return
    const apply = (detail: VariantSelectionDetail | null) => {
      // Another product's island on the same page is none of our business.
      if (detail && detail.parentProductId && detail.parentProductId !== parentProductId) return
      setVariantId(detail?.productId ?? null)
    }
    apply(readSnapshot())
    const onSelect = (event: Event) => apply((event as CustomEvent<VariantSelectionDetail>).detail ?? null)
    window.addEventListener(VARIANT_SELECTION_EVENT, onSelect)
    return () => window.removeEventListener(VARIANT_SELECTION_EVENT, onSelect)
  }, [view?.parentProductId])

  if (!view?.sections || view.sections.length === 0) return null

  // -1 for "no variation, or one this product carries no spec values for", which
  // is the same thing as far as the table is concerned: show the range.
  const index = variantId ? (view.variantIds ?? []).indexOf(variantId) : -1
  const chosen = index >= 0

  const sections = view.sections
    .map((section) => ({
      ...section,
      // The column-fill weight for auto-sort, counted from the RANGE's rows
      // rather than the filtered ones below: a chosen variation drops rows out,
      // and sorting on the filtered counts would shuffle the groups the moment
      // an option is picked. The header takes about a row's height, so a named
      // group weighs one more than its lines.
      weight: section.rows.length + (section.name ? 1 : 0),
      rows: section.rows
        .map((row) => {
          if (!chosen || !row.perVariant) return { ...row }
          const value = row.perVariant[index]
          // Null is not a gap to paper over: it means this line does not apply
          // to the chair they picked (a bespoke-only range, arms on an armless
          // chair), so the line goes rather than reading blank.
          if (value == null) return null
          return { ...row, value }
        })
        .filter((row): row is { label: string; value: string } => row !== null),
    }))
    .filter((section) => section.rows.length > 0)

  if (sections.length === 0) return null

  // Tallest groups first so the big blocks anchor the columns and the small
  // ones fill in behind them, instead of two giants sharing one column while
  // the others run short. Sort is stable, so equal-height groups keep the
  // owner's order; off, the owner's order stands untouched.
  if (autoSort) sections.sort((a, b) => b.weight - a.weight)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: specCss(view.breakpoints ?? DEFAULT_BREAKPOINTS) }} />
      <div className="pat-spec">
        {chosen && (
          <span className="pat-spec-choice">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Your choice
          </span>
        )}
        <div className="pat-spec-cols">
          {sections.map((section) => (
            <div className="pat-spec-item" key={section.id ?? '__unsectioned'}>
              <div className="pat-spec-group">
                {section.name && <div className="pat-spec-head">{section.name}</div>}
                <table className="pat-spec-table">
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
