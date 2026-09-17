import { flushSync } from 'react-dom'

// Grows the attribute-filtered product grid without moving the page.
//
// Its own copy rather than an import from shop, the same call filters-for-shop
// made: a new file imported across modules would tie this module's release to
// a shop release, for forty lines.
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
// the shopper is reading from shoving the page about. This stops only the
// movement the new cards would cause.
//
// Two browsers, two moments, so two guards:
//
// Firefox applies the adjustment inside layout. Reading the scroll position back
// after the commit forces that layout, so the position read is the adjusted one
// and putting it back happens in the same task - nothing is painted in between.
//
// Chrome does not. Its adjustment is queued during layout and applied by the
// next animation frame (LocalFrameView::RunStyleAndLayoutLifecyclePhases, never
// UpdateStyleAndLayout), so at this point the page has not moved yet and there
// is nothing to read back: the first version of this helper relied on that read
// alone, shipped, and changed nothing. What Chrome does honour is an explicit
// scroll that actually moves - PaintLayerScrollableArea::UpdateScrollOffset
// clears the anchor for any user or programmatic scroll - and an adjustment
// whose anchor has been cleared is dropped when the frame comes round. So: one
// pixel up and straight back, in the same task. Nothing is painted between the
// two, and the next frame picks a fresh anchor from the finished layout.
//
// A browser without scroll anchoring never moved, and both guards are no-ops.
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
  const left = window.scrollX
  flushSync(update)
  if (window.scrollY !== top || window.scrollX !== left) {
    window.scrollTo({ top, left, behavior: 'instant' })
  }
  // At the very top there is no anchoring to defeat - a scroller at offset zero
  // drops its anchor on its own - and no room to nudge upwards anyway.
  if (top > 0) {
    window.scrollTo({ top: top - 1, left, behavior: 'instant' })
    window.scrollTo({ top, left, behavior: 'instant' })
  }
}
