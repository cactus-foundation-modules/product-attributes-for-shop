import { describe, it, expect } from 'vitest'
import { formatSwatchFileSize, describeSwatchFile, describeSwatchRenditions } from '@/modules/product-attributes-for-shop/lib/swatch-rendition'
import type { PatSwatchFileInfo } from '@/modules/product-attributes-for-shop/lib/types'

const FULL = 'https://media.example.com/swatches/oak.jpg'
const SMALL = 'https://media.example.com/swatches/oak-small.webp'

function files(entries: Record<string, PatSwatchFileInfo>) {
  return entries
}

describe('formatSwatchFileSize', () => {
  it('counts small files in bytes and the rest in KB or MB', () => {
    expect(formatSwatchFileSize(400)).toBe('400 B')
    expect(formatSwatchFileSize(24_000)).toBe('23 KB')
    expect(formatSwatchFileSize(2_400_000)).toBe('2.3 MB')
  })
})

describe('describeSwatchFile', () => {
  it('gives weight and dimensions when the library has measured them', () => {
    expect(describeSwatchFile({ bytes: 24_000, width: 400, height: 400 })).toBe('23 KB, 400 x 400')
  })

  it('gives weight alone for a picture nobody has measured', () => {
    expect(describeSwatchFile({ bytes: 24_000, width: null, height: null })).toBe('23 KB')
  })

  it('says so rather than guessing when the picture is not a library item', () => {
    expect(describeSwatchFile(undefined)).toBe('size unknown, not in the media library')
  })
})

describe('describeSwatchRenditions', () => {
  it('marks the small copy as the one option swatches draw', () => {
    const notes = describeSwatchRenditions(FULL, SMALL, files({
      [FULL]: { bytes: 2_400_000, width: 2000, height: 2000 },
      [SMALL]: { bytes: 24_000, width: 400, height: 400 },
    }))
    expect(notes.verdict).toBe('has-small')
    expect(notes.usedForOptions).toBe('small')
    expect(notes.small).toContain('23 KB, 400 x 400')
    expect(notes.small).toContain('what product option swatches draw')
    // The full one has to say it is NOT the swatch, or the pair reads as two
    // pictures doing the same job.
    expect(notes.full).toContain('2.3 MB, 2000 x 2000')
    expect(notes.full).toContain('Not what product option swatches draw')
  })

  it('falls back to the full picture, and asks for a copy, when none exists', () => {
    const notes = describeSwatchRenditions(FULL, null, files({
      [FULL]: { bytes: 2_400_000, width: 2000, height: 2000 },
    }))
    expect(notes.verdict).toBe('wants-small')
    expect(notes.usedForOptions).toBe('full')
    expect(notes.full).toContain('Used for product option swatches')
    expect(notes.small).toContain('Make small copies')
  })

  it('does not ask for a copy the resizer would decline to make', () => {
    const notes = describeSwatchRenditions(FULL, null, files({
      [FULL]: { bytes: 20_000, width: 300, height: 300 },
    }))
    expect(notes.verdict).toBe('small-enough')
    expect(notes.usedForOptions).toBe('full')
    expect(notes.small).toContain('already small enough')
    expect(notes.small).not.toContain('Make small copies')
  })

  it('hedges when a light picture has never been measured', () => {
    const notes = describeSwatchRenditions(FULL, null, files({
      [FULL]: { bytes: 20_000, width: null, height: null },
    }))
    expect(notes.verdict).toBe('maybe-small-enough')
    expect(notes.small).toContain('may save nothing')
  })

  it('still wants a copy of a heavy picture nobody has measured', () => {
    const notes = describeSwatchRenditions(FULL, null, files({
      [FULL]: { bytes: 2_400_000, width: null, height: null },
    }))
    expect(notes.verdict).toBe('wants-small')
  })

  it('says a picture is not a library item rather than reporting no size', () => {
    const notes = describeSwatchRenditions('https://elsewhere.example/oak.jpg', null, files({}))
    expect(notes.verdict).toBe('not-in-library')
    expect(notes.full).toContain('size unknown')
    expect(notes.small).toContain('nothing to shrink')
  })

  it('offers to set a picture on a value that has none', () => {
    const notes = describeSwatchRenditions(null, null, files({}))
    expect(notes.verdict).toBe('no-picture')
    expect(notes.full).toContain('No picture yet')
    expect(notes.small).toContain('no picture to shrink')
  })
})
