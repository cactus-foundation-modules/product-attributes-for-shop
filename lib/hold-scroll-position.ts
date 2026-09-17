import { flushSync } from 'react-dom'

// Grows the attribute-filtered product grid without moving the page.
//
// Its own copy rather than an import from shop, the same call filters-for-shop
// made: a new file imported across modules would tie this module's release to
// a shop release, for twenty lines.
//
// Browsers with scroll anchoring (Chrome, Edge, Firefox) pick an element on
// screen and keep it where it is when content above it changes size. A shopper
// who has scrolled to the end of a grid is looking at the pager or the footer,
// so that is what gets picked - and when the next page of cards lands above it,
// the browser scrolls down by the height of those cards to keep the footer in
// view. The shopper asked for more products and is shown the footer again. A
// click on "Show more" goes the same way by a different door: a focused element
// is the browser's first choice of anchor, so the page follows the button down
// and the new products end up above the fold.
//
// `overflow-anchor: none` would stop it, but only by switching anchoring off for
// the whole page, and anchoring is what stops an image loading late above where
// the shopper is reading from shoving the page about. This undoes only the
// movement the new cards caused.
//
// Note where the page is, commit the update synchronously, read the position
// back. Reading it forces layout, the anchoring adjustment is made as part of
// that layout, and putting it back happens in the same task - so nothing is
// painted in between and nothing visibly moves. The put-back is an ordinary
// scroll, which is also what makes the browser drop the anchor it chose. A
// browser without scroll anchoring never moved, and never reaches the scrollTo.
//
// Must not be called during render or from an effect: React is mid-commit
// there, cannot flush, and says so in the console.
// An event handler or an observer callback are both fine, and those are the
// only places the grid grows from.
export function holdScrollPosition(update: () => void): void {
  if (typeof window === 'undefined') {
    update()
    return
  }
  const top = window.scrollY
  flushSync(update)
  if (window.scrollY !== top) window.scrollTo({ top, left: window.scrollX, behavior: 'instant' })
}
