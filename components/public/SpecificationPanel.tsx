'use client'

// The Specification tab's body on the product page, when this module has taken
// it over for a product (shop's lib/detail-spec.ts). Shop's own SKU/Type/Weight/
// Dimensions facts give way to the product's own attributes, sorted into the
// headed sections the owner built on the Attributes tab.
//
// A client component because shop hands a replaced panel down through the RSC
// boundary as a prop, and a server component cannot be passed that way (see
// shop's lib/detail-spec.ts). Nothing here needs the server: the spec was
// resolved while the page rendered, and this only draws it - still into the first
// HTML, so it is there for a crawler and for anyone without JavaScript.

import type { PatProductSpecView } from '@/modules/product-attributes-for-shop/lib/db/spec-view'

// Class names are this module's own; the colours are the site's tokens, so the
// table sits in shop's Specification panel looking like it belongs there in both
// light and dark.
const css = `
.pat-spec{display:grid;gap:16px}
.pat-spec-group{border:1px solid var(--color-border);border-radius:12px;overflow:hidden}
.pat-spec-head{font-weight:600;font-size:15px;padding:12px 16px;background:var(--color-bg-subtle);
  border-bottom:1px solid var(--color-border);color:var(--color-text)}
.pat-spec-table{width:100%;border-collapse:collapse}
.pat-spec-table tr+tr td{border-top:1px solid var(--color-border)}
.pat-spec-table td{padding:12px 16px;font-size:14px;vertical-align:top;line-height:1.4}
.pat-spec-table td:first-child{color:var(--color-text-muted);width:40%;padding-right:24px}
.pat-spec-table td:last-child{color:var(--color-text);font-weight:500}
`

export function SpecificationPanel({ payload }: { payload: unknown }) {
  const { sections } = payload as PatProductSpecView
  if (!sections || sections.length === 0) return null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="pat-spec">
        {sections.map((section) => (
          <div className="pat-spec-group" key={section.id ?? '__unsectioned'}>
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
        ))}
      </div>
    </>
  )
}
