'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PatAttributeWithValues } from '@/modules/product-attributes-for-shop/lib/types'
import { matchesSelection } from '@/modules/product-attributes-for-shop/lib/filter-logic'

export type FilterShellProps = {
  attributes: PatAttributeWithValues[]
  // product id -> the value ids it matches (its own, plus its enabled variants').
  matrix: Record<string, string[]>
  counts: Record<string, number>
  columns: number
  position: 'left' | 'top'
  showCounts: boolean
  // Server-rendered cards. They arrive already stamped with the shop's own
  // Product Card layout, each tagged data-pat-product, and are only ever
  // shown/hidden here - never re-rendered, so the card design is untouched.
  children: React.ReactNode
}

function readInitialSelection(attributes: PatAttributeWithValues[]): Map<string, Set<string>> {
  const selected = new Map<string, Set<string>>()
  if (typeof window === 'undefined') return selected
  const params = new URLSearchParams(window.location.search)
  for (const attribute of attributes) {
    const raw = params.get(attribute.slug)
    if (!raw) continue
    const slugs = new Set(raw.split(',').filter(Boolean))
    const ids = attribute.values.filter((v) => slugs.has(v.slug)).map((v) => v.id)
    if (ids.length > 0) selected.set(attribute.id, new Set(ids))
  }
  return selected
}

export function AttributeFilterShell({ attributes, matrix, counts, columns, position, showCounts, children }: FilterShellProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map())
  const [visibleCount, setVisibleCount] = useState<number | null>(null)

  // Read the URL only after mount: the cards are server-rendered and must not
  // depend on the query string, or the markup would mismatch on hydration.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is only readable post-mount; seeding during render would mismatch the server-rendered cards
    setSelected(readInitialSelection(attributes))
  }, [attributes])

  const valueSlugById = useMemo(() => {
    const map = new Map<string, { attributeSlug: string; valueSlug: string }>()
    for (const attribute of attributes) {
      for (const value of attribute.values) map.set(value.id, { attributeSlug: attribute.slug, valueSlug: value.slug })
    }
    return map
  }, [attributes])

  // Show/hide the server-rendered cards in place, then mirror the selection into
  // the URL so a filtered view can be shared or reached with the back button.
  // replaceState (not a router push) keeps the server render out of it entirely.
  useEffect(() => {
    const root = gridRef.current
    if (!root) return
    let shown = 0
    for (const el of root.querySelectorAll<HTMLElement>('[data-pat-product]')) {
      const productId = el.dataset.patProduct ?? ''
      const ok = matchesSelection(matrix[productId] ?? [], selected)
      el.style.display = ok ? '' : 'none'
      el.toggleAttribute('data-pat-hidden', !ok)
      if (ok) shown++
    }
    setVisibleCount(shown)

    const params = new URLSearchParams(window.location.search)
    for (const attribute of attributes) params.delete(attribute.slug)
    for (const [attributeId, valueIds] of selected) {
      if (valueIds.size === 0) continue
      const attribute = attributes.find((a) => a.id === attributeId)
      if (!attribute) continue
      const slugs = [...valueIds].map((id) => valueSlugById.get(id)?.valueSlug).filter(Boolean)
      if (slugs.length > 0) params.set(attribute.slug, slugs.join(','))
    }
    const query = params.toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }, [selected, matrix, attributes, valueSlugById])

  function toggle(attributeId: string, valueId: string) {
    setSelected((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(attributeId) ?? [])
      if (set.has(valueId)) set.delete(valueId)
      else set.add(valueId)
      if (set.size === 0) next.delete(attributeId)
      else next.set(attributeId, set)
      return next
    })
  }

  function selectOnly(attributeId: string, valueId: string | '') {
    setSelected((prev) => {
      const next = new Map(prev)
      if (!valueId) next.delete(attributeId)
      else next.set(attributeId, new Set([valueId]))
      return next
    })
  }

  const activeCount = [...selected.values()].reduce((n, s) => n + s.size, 0)
  const shownAttributes = attributes.filter((a) => a.values.length > 0)
  if (shownAttributes.length === 0) {
    return (
      <div className="shop-grid" style={{ ['--shop-cols' as string]: String(columns) } as React.CSSProperties} ref={gridRef}>
        {children}
      </div>
    )
  }

  return (
    <div className={`pat-wrap pat-pos-${position}`}>
      <aside className="pat-filters" aria-label="Filter products">
        <div className="pat-filters-head">
          <h2 className="pat-filters-title">Filter</h2>
          {activeCount > 0 && (
            <button type="button" className="pat-clear" onClick={() => setSelected(new Map())}>
              Clear{activeCount > 1 ? ` (${activeCount})` : ''}
            </button>
          )}
        </div>

        {shownAttributes.map((attribute) => (
          <fieldset key={attribute.id} className="pat-group">
            <legend className="pat-legend">{attribute.name}</legend>

            {attribute.controlType === 'DROPDOWN' ? (
              <select
                className="pat-select"
                value={[...(selected.get(attribute.id) ?? [])][0] ?? ''}
                onChange={(e) => selectOnly(attribute.id, e.target.value)}
                aria-label={attribute.name}
              >
                <option value="">Any</option>
                {attribute.values.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.label}{showCounts ? ` (${counts[value.id] ?? 0})` : ''}
                  </option>
                ))}
              </select>
            ) : attribute.controlType === 'SWATCH' ? (
              <div className="pat-swatches">
                {attribute.values.map((value) => {
                  const on = selected.get(attribute.id)?.has(value.id) ?? false
                  return (
                    <button
                      key={value.id}
                      type="button"
                      className={`pat-swatch${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      title={showCounts ? `${value.label} (${counts[value.id] ?? 0})` : value.label}
                      onClick={() => toggle(attribute.id, value.id)}
                    >
                      <span className="pat-swatch-dot" style={{ background: value.swatch ?? 'var(--color-bg-subtle)' }} aria-hidden />
                      <span className="pat-swatch-label">{value.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="pat-ticks">
                {attribute.values.map((value) => (
                  <label key={value.id} className="pat-tick">
                    <input
                      type="checkbox"
                      checked={selected.get(attribute.id)?.has(value.id) ?? false}
                      onChange={() => toggle(attribute.id, value.id)}
                    />
                    <span>{value.label}</span>
                    {showCounts && <span className="pat-count">{counts[value.id] ?? 0}</span>}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ))}
      </aside>

      <div className="pat-results">
        <div className="shop-grid" style={{ ['--shop-cols' as string]: String(columns) } as React.CSSProperties} ref={gridRef}>
          {children}
        </div>
        {visibleCount === 0 && (
          <p className="pat-empty">
            Nothing matches those filters.{' '}
            <button type="button" className="pat-clear" onClick={() => setSelected(new Map())}>Clear them</button> and try again.
          </p>
        )}
      </div>
    </div>
  )
}
