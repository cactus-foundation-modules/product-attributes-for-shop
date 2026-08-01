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
// The groups sit three abreast on desktop, two on tablet and one on mobile,
// collapsing at the site's own Styles > Spacing & Breakpoints widths (handed in
// by lib/detail-spec-provider.ts) rather than at bespoke pixels. `align-items:
// start` so a short group keeps its own height instead of stretching to match
// the tallest one in its row, and the "Your choice" note spans the full width
// above them rather than taking a column of its own.
const specCss = ({ tabletBp, mobileBp }: Breakpoints) => `
.pat-spec{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
.pat-spec-chosen{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-text-muted)}
.pat-spec-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;
  background:var(--color-primary-subtle);color:var(--color-primary-dark);
  border:1px solid var(--color-primary-border)}
.pat-spec-group{border:1px solid var(--color-border);border-radius:12px;overflow:hidden}
.pat-spec-head{font-weight:600;font-size:15px;padding:12px 16px;background:var(--color-bg-subtle);
  border-bottom:1px solid var(--color-border);color:var(--color-text)}
.pat-spec-table{width:100%;border-collapse:collapse}
.pat-spec-table tr+tr td{border-top:1px solid var(--color-border)}
.pat-spec-table td{padding:12px 16px;font-size:14px;vertical-align:top;line-height:1.4}
.pat-spec-table td:first-child{color:var(--color-text-muted);width:40%;padding-right:24px}
.pat-spec-table td:last-child{color:var(--color-text);font-weight:500}
.pat-spec-table tr[data-pat-yours] td:first-child{box-shadow:inset 3px 0 0 var(--color-primary)}
@media (max-width:${tabletBp}){.pat-spec{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:${mobileBp}){.pat-spec{grid-template-columns:minmax(0,1fr)}}
`

export function SpecificationPanel({ payload }: { payload: unknown }) {
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
      rows: section.rows
        .map((row) => {
          if (!chosen || !row.perVariant) return { ...row, yours: false }
          const value = row.perVariant[index]
          // Null is not a gap to paper over: it means this line does not apply
          // to the chair they picked (a bespoke-only range, arms on an armless
          // chair), so the line goes rather than reading blank.
          if (value == null) return null
          return { ...row, value, yours: true }
        })
        .filter((row): row is { label: string; value: string; yours: boolean } => row !== null),
    }))
    .filter((section) => section.rows.length > 0)

  if (sections.length === 0) return null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: specCss(view.breakpoints ?? DEFAULT_BREAKPOINTS) }} />
      <div className="pat-spec">
        {chosen && (
          <div className="pat-spec-chosen">
            <span className="pat-spec-pill">Your choice</span>
            <span>Figures below are for the options you have picked.</span>
          </div>
        )}
        {sections.map((section) => (
          <div className="pat-spec-group" key={section.id ?? '__unsectioned'}>
            {section.name && <div className="pat-spec-head">{section.name}</div>}
            <table className="pat-spec-table">
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.label} data-pat-yours={row.yours ? '' : undefined}>
                    <td>{row.label}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  )
}
