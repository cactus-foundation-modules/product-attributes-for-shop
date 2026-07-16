import { describe, it, expect } from 'vitest'
import { matchesSelection } from '@/modules/product-attributes-for-shop/lib/filter-logic'

// Shorthand: { attributeId: [valueId, ...] } -> the Map/Set shape the shell holds.
function sel(spec: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(spec).map(([k, v]) => [k, new Set(v)]))
}

describe('matchesSelection', () => {
  it('keeps everything when nothing is ticked', () => {
    expect(matchesSelection([], sel({}))).toBe(true)
    expect(matchesSelection(['red'], sel({}))).toBe(true)
  })

  it('ORs values within one attribute', () => {
    const selected = sel({ colour: ['red', 'blue'] })
    expect(matchesSelection(['red'], selected)).toBe(true)
    expect(matchesSelection(['blue'], selected)).toBe(true)
    expect(matchesSelection(['green'], selected)).toBe(false)
  })

  it('ANDs across attributes', () => {
    const selected = sel({ colour: ['red'], material: ['oak'] })
    expect(matchesSelection(['red', 'oak'], selected)).toBe(true)
    // Satisfies colour but not material - the whole point of AND.
    expect(matchesSelection(['red'], selected)).toBe(false)
    expect(matchesSelection(['oak'], selected)).toBe(false)
  })

  it('combines both rules: (red or blue) and oak', () => {
    const selected = sel({ colour: ['red', 'blue'], material: ['oak'] })
    expect(matchesSelection(['blue', 'oak'], selected)).toBe(true)
    expect(matchesSelection(['green', 'oak'], selected)).toBe(false)
    expect(matchesSelection(['blue', 'walnut'], selected)).toBe(false)
  })

  it('ignores an attribute whose ticks were all cleared', () => {
    // The shell deletes emptied keys, but a stale empty set must not exclude
    // every product by matching nothing.
    expect(matchesSelection(['red'], sel({ colour: [], material: [] }))).toBe(true)
  })

  it('excludes a product carrying no values once any filter is on', () => {
    expect(matchesSelection([], sel({ colour: ['red'] }))).toBe(false)
  })

  it('matches a parent via a value only one of its variants carries', () => {
    // The rollup unions the parent's own values with its enabled variants', so a
    // shirt that is only red in one variant still answers "Colour: Red".
    const rolledUp = ['cotton', 'red', 'blue', 'green']
    expect(matchesSelection(rolledUp, sel({ colour: ['red'] }))).toBe(true)
    expect(matchesSelection(rolledUp, sel({ colour: ['red'], material: ['cotton'] }))).toBe(true)
    expect(matchesSelection(rolledUp, sel({ colour: ['red'], material: ['linen'] }))).toBe(false)
  })
})
