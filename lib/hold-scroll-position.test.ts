import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdScrollPosition } from '@/modules/product-attributes-for-shop/lib/hold-scroll-position'

// The attribute-filtered grid growing under a shopper who has scrolled to the end of it. The
// browser's own anchoring is stood in for by an update that moves the page, which
// is what it amounts to from here: the position reads differently afterwards.

type FakeWindow = { scrollX: number; scrollY: number; scrollTo: ReturnType<typeof vi.fn> }

function fakeWindow(scrollY: number): FakeWindow {
  const win: FakeWindow = { scrollX: 0, scrollY, scrollTo: vi.fn() }
  vi.stubGlobal('window', win)
  return win
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('holdScrollPosition', () => {
  it('puts the page back when the new cards carried it down', () => {
    const win = fakeWindow(1800)
    holdScrollPosition(() => { win.scrollY = 4200 })
    expect(win.scrollTo).toHaveBeenCalledWith({ top: 1800, left: 0, behavior: 'instant' })
  })

  it('leaves a page that did not move alone', () => {
    const win = fakeWindow(1800)
    const update = vi.fn()
    holdScrollPosition(update)
    expect(update).toHaveBeenCalledOnce()
    expect(win.scrollTo).not.toHaveBeenCalled()
  })

  it('still applies the update where there is no window', () => {
    const update = vi.fn()
    holdScrollPosition(update)
    expect(update).toHaveBeenCalledOnce()
  })
})
