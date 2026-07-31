import { describe, it, expect } from 'vitest'
import { summariseSpecValues, distinctSpecValues } from '@/modules/product-attributes-for-shop/lib/spec-format'

describe('distinctSpecValues', () => {
  it('drops repeats and nulls, keeping first-seen order', () => {
    expect(distinctSpecValues(['47cm', null, '47cm', '52cm', null, '44cm'])).toEqual(['47cm', '52cm', '44cm'])
  })

  it('is empty when every variation carries nothing', () => {
    expect(distinctSpecValues([null, null])).toEqual([])
  })
})

describe('summariseSpecValues', () => {
  it('says nothing about nothing', () => {
    expect(summariseSpecValues([])).toBe('')
  })

  it('passes a lone value straight through', () => {
    expect(summariseSpecValues(['3 Years'])).toBe('3 Years')
  })

  it('spans measurements by their extremes', () => {
    expect(summariseSpecValues(['13kg', '8.4kg', '23.4kg'])).toBe('8.4kg - 23.4kg')
    expect(summariseSpecValues(['67cm', '57cm', '79cm', '61cm'])).toBe('57cm - 79cm')
  })

  it('spans values that are themselves ranges, by the outer extremes', () => {
    // A chair adjusts 44-56cm in one variation and 89.5-99.5cm in another.
    expect(summariseSpecValues(['44-56cm', '89.5-99.5cm'])).toBe('44cm - 99.5cm')
  })

  it('keeps each value\'s own spacing before the unit', () => {
    expect(summariseSpecValues(['57 cm', '79 cm'])).toBe('57 cm - 79 cm')
    // Worded units need their space: "6hours" is not a thing anyone says.
    expect(summariseSpecValues(['8 hours', '6 hours', '24 hours'])).toBe('6 hours - 24 hours')
  })

  it('collapses a span whose ends match', () => {
    expect(summariseSpecValues(['50cm', '50 cm'])).toBe('50cm')
  })

  it('never spans across different units', () => {
    // "10" of two different things is not a range, so it falls back to a list.
    expect(summariseSpecValues(['10kg', '10cm'])).toBe('10kg, 10cm')
  })

  it('lists a handful of names', () => {
    expect(summariseSpecValues(['Yes', 'No'])).toBe('Yes, No')
    expect(summariseSpecValues(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a, b, c, d, e, f')
  })

  it('counts instead of listing once there are too many to read', () => {
    const many = Array.from({ length: 92 }, (_, i) => `Colour ${i + 1}`)
    expect(summariseSpecValues(many)).toBe('92 choices - select your options to see yours')
  })

  it('falls back to a list when only some values are measurements', () => {
    expect(summariseSpecValues(['57cm', 'Not applicable'])).toBe('57cm, Not applicable')
  })
})
