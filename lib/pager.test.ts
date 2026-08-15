import { describe, expect, it } from 'vitest'
import { attributePageNumbers } from '@/modules/product-attributes-for-shop/components/public/AttributeFilterShell'

// The page-number window and the slicing arithmetic the attribute shell applies
// to its filtered cards. Restated here because the slicing itself lives in an
// effect that walks the DOM, and it is the part that can quietly drop a product.

// Exactly the window the paging effect computes.
function windowFor(paginate: 'more' | 'pages', pageSize: number, page: number, shown: number): [number, number] {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const from = paginate === 'more' ? 0 : (page - 1) * size
  const to = paginate === 'more' ? Math.max(size, shown) : from + size
  return [from, to]
}

describe('paging window over the filtered set', () => {
  it('covers a full category exactly once, with no gaps', () => {
    const total = 217
    const size = 24
    const seen = new Set<number>()
    for (let page = 1; page <= Math.ceil(total / size); page++) {
      const [from, to] = windowFor('pages', size, page, 0)
      for (let i = from; i < Math.min(to, total); i++) {
        expect(seen.has(i)).toBe(false)
        seen.add(i)
      }
    }
    expect(seen.size).toBe(total)
  })

  it('leaves the remainder on the last page', () => {
    const [from, to] = windowFor('pages', 24, 5, 0)
    expect(Math.min(to, 100) - from).toBe(4)
  })

  it('grows on "show more" and never falls below one page', () => {
    expect(windowFor('more', 24, 1, 0)).toEqual([0, 24])
    expect(windowFor('more', 24, 1, 48)).toEqual([0, 48])
  })

  it('survives a page size of zero', () => {
    expect(windowFor('pages', 0, 1, 0)).toEqual([0, 1])
  })
})

describe('attributePageNumbers', () => {
  it('lists every page when there are few enough to read', () => {
    expect(attributePageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the first, the last and a window around the current page', () => {
    expect(attributePageNumbers(5, 20)).toEqual([1, '…', 4, 5, 6, '…', 20])
  })

  it('does not open or close with a redundant gap', () => {
    expect(attributePageNumbers(2, 20)).toEqual([1, 2, 3, '…', 20])
    expect(attributePageNumbers(19, 20)).toEqual([1, '…', 18, 19, 20])
  })

  it('never repeats a page number', () => {
    for (let last = 1; last <= 30; last++) {
      for (let current = 1; current <= last; current++) {
        const nums = attributePageNumbers(current, last).filter((n): n is number => n !== '…')
        expect(new Set(nums).size).toBe(nums.length)
      }
    }
  })
})
