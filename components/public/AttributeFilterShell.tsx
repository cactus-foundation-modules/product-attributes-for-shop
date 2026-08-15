'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PatAttributeWithValues } from '@/modules/product-attributes-for-shop/lib/types'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
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
  // Paging over whatever the filters have left. 'none' is what this shell did
  // before: every matching card on screen at once. Inside the shell rather than
  // around it because the set being paged is the FILTERED set - see the paging
  // effect below, and the identical reasoning in filters-for-shop.
  // 'scroll' is 'more' that presses its own button - same window, same handler,
  // triggered by a sentinel coming into view. The button stays either way: an
  // observer is unreachable by keyboard, invisible to a screen reader, and does
  // nothing where the page never scrolls (a filtered list of nine).
  paginate?: 'none' | 'more' | 'pages' | 'scroll'
  pageSize?: number
  moreLabel?: string
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

// First, last and a window either side of the current page. A local copy rather
// than an import from another module: this module owns its own UI, and reaching
// into a sibling for a list of numbers is exactly the coupling the module rules
// are there to prevent.
export function attributePageNumbers(current: number, last: number): (number | '\u2026')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const out: (number | '\u2026')[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(last - 1, current + 1)
  if (from > 2) out.push('\u2026')
  for (let n = from; n <= to; n++) out.push(n)
  if (to < last - 1) out.push('\u2026')
  out.push(last)
  return out
}

// useLayoutEffect where there is a DOM, useEffect where there is not.
//
// The paging pass has to land BEFORE the browser paints. A plain useEffect runs
// after paint, so a category of 217 products drew all 217 cards and then hid 193
// of them - a visible flash and a scrollbar that jumps under the shopper's hand.
// useLayoutEffect runs before paint and the shopper only ever sees the page they
// asked for.
//
// React warns if useLayoutEffect is called during a server render, and this
// component IS server-rendered, so the choice is made once here rather than
// suppressed at the call site.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function AttributeFilterShell({ attributes, matrix, counts, columns, position, showCounts, children, paginate = 'none', pageSize = 24, moreLabel }: FilterShellProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map())
  const [visibleCount, setVisibleCount] = useState<number | null>(null)
  // How many of the matching cards are on screen. 'more' grows this window;
  // 'pages' slides it. Both are ignored entirely when paginate is 'none'.
  const [shownLimit, setShownLimit] = useState(pageSize)
  const [page, setPage] = useState(1)
  // Back to the top whenever the filtered set changes, or a shopper on page 5
  // who ticks a colour that leaves four products lands on an empty grid.
  // Adjusted during render rather than in an effect - React's own pattern for
  // state that must follow its inputs, and it avoids painting the wrong page
  // first and correcting it after.
  const pageResetKey = `${[...selected.entries()].map(([a, v]) => `${a}:${[...v].sort().join(',')}`).sort().join('|')}|${pageSize}`
  const [lastResetKey, setLastResetKey] = useState(pageResetKey)
  if (pageResetKey !== lastResetKey) {
    setLastResetKey(pageResetKey)
    setShownLimit(pageSize)
    setPage(1)
  }

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

  // The paging window, applied over whatever the filter pass has left.
  //
  // Declared AFTER the filter effect on purpose: effects run in declaration
  // order, so by the time this reads the DOM the non-matching cards already
  // carry data-pat-hidden. It uses the same selector as that pass so the two
  // walk the cards in the same order, and writes the same `display` property -
  // they never disagree, because this only ever hides cards the filter pass has
  // already shown.
  useIsomorphicLayoutEffect(() => {
    if (paginate === 'none') return
    const root = gridRef.current
    if (!root) return
    const size = Math.max(1, Math.floor(pageSize) || 1)
    const matching = [...root.querySelectorAll<HTMLElement>('[data-pat-product]')]
      .filter((el) => !el.hasAttribute('data-pat-hidden'))
    const growing = paginate === 'more' || paginate === 'scroll'
    const from = growing ? 0 : (page - 1) * size
    const to = growing ? Math.max(size, shownLimit) : from + size
    matching.forEach((el, i) => {
      const onThisPage = i >= from && i < to
      el.style.display = onThisPage ? '' : 'none'
      el.toggleAttribute('data-pat-offpage', !onThisPage)
    })
  }, [paginate, pageSize, page, shownLimit, selected, matrix])

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

  // How many cards the filters have left - what the pager pages over. Falls
  // back to the whole set before the first filter pass has run.
  const matchingTotal = visibleCount ?? Object.keys(matrix).length
  const lastPage = Math.max(1, Math.ceil(matchingTotal / Math.max(1, pageSize)))
  // One way to grow the window, whether a thumb or the observer asked for it.
  const growing = paginate === 'more' || paginate === 'scroll'
  const moreToShow = growing && shownLimit < matchingTotal
  // Clamped, matching shop's own pager. The `moreToShow` gate below already
  // unmounts the button and the sentinel once everything is on screen, so an
  // unbounded counter was never actually reachable - but leaving it unbounded
  // means the one number the observer drives has no ceiling at all, and the two
  // implementations of the same idea disagreed. They agree now.
  const showMore = useCallback(
    () => setShownLimit((n) => Math.min(n + pageSize, matchingTotal)),
    [pageSize, matchingTotal],
  )
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (paginate !== 'scroll' || !moreToShow) return
    const node = sentinelRef.current
    // No sentinel or no observer leaves the button doing the whole job, which
    // it can, because it never went away.
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) showMore() },
      // Load before the shopper reaches the end, so the next row is usually
      // there by the time they arrive at where it goes.
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [paginate, moreToShow, showMore])
  const pager =
    paginate !== 'none' && matchingTotal > pageSize ? (
      <nav className="pat-pager" aria-label="Product pages">
        {growing ? (
          moreToShow && (
            <>
              <button type="button" className="pat-pager-more" onClick={showMore}>
                {moreLabel || 'Show more'}
              </button>
              {/* What the observer watches: a scroll position, not content, so
                  it is empty and hidden from assistive tech. */}
              {paginate === 'scroll' && <div ref={sentinelRef} aria-hidden="true" style={{ width: '100%', height: 1 }} />}
            </>
          )
        ) : (
          <ul className="pat-pager-pages">
            <li>
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page">
                &lsaquo;
              </button>
            </li>
            {attributePageNumbers(page, lastPage).map((n, i) =>
              n === '\u2026' ? (
                <li key={`gap-${i}`} className="pat-pager-gap" aria-hidden="true">&hellip;</li>
              ) : (
                <li key={n}>
                  <button type="button" onClick={() => setPage(n as number)} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`}>
                    {n}
                  </button>
                </li>
              ),
            )}
            <li>
              <button type="button" onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page === lastPage} aria-label="Next page">
                &rsaquo;
              </button>
            </li>
          </ul>
        )}
      </nav>
    ) : null

  // A page with no attribute filters at all still pages - the products are just
  // as unreachable there, and this branch renders the same grid.
  if (shownAttributes.length === 0) {
    return (
      <>
        <div className="shop-grid" style={{ ['--shop-cols' as string]: String(columns) } as React.CSSProperties} ref={gridRef}>
          {children}
        </div>
        {pager}
      </>
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
            ) : attribute.controlType === 'IMAGE' ? (
              <div className="pat-images">
                {attribute.values.map((value) => {
                  const on = selected.get(attribute.id)?.has(value.id) ?? false
                  // A value whose swatch is a colour (the attribute was switched
                  // from colours to pictures, say) shows the empty tile rather
                  // than a broken image: the label underneath still names it.
                  const picture = value.swatch && isImageSwatch(value.swatch) ? value.swatch : null
                  return (
                    <button
                      key={value.id}
                      type="button"
                      className={`pat-image${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      title={showCounts ? `${value.label} (${counts[value.id] ?? 0})` : value.label}
                      onClick={() => toggle(attribute.id, value.id)}
                    >
                      {picture ? (
                        // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
                        <img className="pat-image-pic" src={picture} alt="" loading="lazy" />
                      ) : (
                        <span className="pat-image-pic pat-image-blank" aria-hidden />
                      )}
                      <span className="pat-image-label">{value.label}</span>
                    </button>
                  )
                })}
              </div>
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
        {pager}
      </div>
    </div>
  )
}
