'use client'

import type { PatSwatchFileInfo } from '@/modules/product-attributes-for-shop/lib/types'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { describeSwatchRenditions } from '@/modules/product-attributes-for-shop/lib/swatch-rendition'
import { SwatchImagePicker } from '@/modules/product-attributes-for-shop/components/admin/SwatchImagePicker'

// Both pictures a picture-swatch value keeps, side by side: the full one, which
// is the editable picture and what the 3D module paints onto models at true
// scale, and the small copy, which is what a storefront option swatch draws.
//
// They were shown as one box before, drawing whichever was lighter, which left
// no way to tell whether a value had a small copy at all, how much either file
// weighed, or which of the two the shop was actually putting in front of
// customers. Two boxes, a ring on the one in use, and the rest of it on hovering.
export function SwatchRenditions({ attributeId, label, swatch, swatchSmall, files, disabled, onPick, size = 18 }: {
  attributeId: string
  label: string
  swatch: string | null
  swatchSmall: string | null
  // The screen's url-to-file map. A url missing from it is one the media library
  // has never heard of, which the hover text says rather than swallowing.
  files: Record<string, PatSwatchFileInfo>
  disabled?: boolean
  onPick: (url: string) => void | Promise<void>
  size?: number
}) {
  // An IMAGE attribute can hold a value left behind by a spell as a colour
  // attribute, and a hex string handed to an <img src> draws nothing. Both boxes
  // treat that as "no picture", which is what the picker has always done.
  const picture = swatch && isImageSwatch(swatch) ? swatch : null
  const small = swatchSmall && isImageSwatch(swatchSmall) ? swatchSmall : null
  const notes = describeSwatchRenditions(picture, small, files)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      <SwatchImagePicker
        attributeId={attributeId}
        value={picture}
        // Null on purpose, so this box draws the full picture rather than the
        // small copy standing in for it. Seeing the two renditions is the point,
        // and the img is lazy, so nothing off-screen is fetched to do it.
        previewUrl={null}
        label={label}
        disabled={disabled}
        size={size}
        hoverText={notes.full}
        highlight={notes.usedForOptions === 'full'}
        onPick={onPick}
      />
      {small ? (
        // Read-only: the small copy is made from the full one, never chosen. The
        // way to change it is to change the picture above, or to press "Make
        // small copies" if there is none yet.
        <span
          role="img"
          aria-label={notes.small}
          title={notes.small}
          style={{
            width: size,
            height: size,
            flexShrink: 0,
            overflow: 'hidden',
            display: 'inline-flex',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            outline: notes.usedForOptions === 'small' ? '2px solid var(--color-primary)' : undefined,
            outlineOffset: notes.usedForOptions === 'small' ? 1 : undefined,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader */}
          <img src={small} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </span>
      ) : (
        // An empty dashed box rather than nothing at all: a missing small copy is
        // a fact about the value worth a space on the row, and hovering says
        // whether one is wanted or whether the full picture is small enough.
        <span
          role="img"
          aria-label={notes.small}
          title={notes.small}
          style={{
            width: size,
            height: size,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--color-text-secondary)',
            color: 'var(--color-text-secondary)',
            fontSize: '0.625rem',
            lineHeight: 1,
          }}
        >
          <span aria-hidden>·</span>
        </span>
      )}
    </span>
  )
}
