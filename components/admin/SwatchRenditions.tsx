'use client'

import type { CSSProperties } from 'react'
import type { SwatchFileInfo, SwatchRenditionBox } from '@/lib/media/swatch-renditions'
import { describeSwatchRenditions } from '@/lib/media/swatch-renditions'
import { AdminTooltip } from '@/components/admin/Tooltip'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { SwatchImagePicker } from '@/modules/product-attributes-for-shop/components/admin/SwatchImagePicker'

// All three pictures a picture-swatch value keeps, side by side:
//
//   - the full one, the editable picture, which the 3D module paints onto models
//     at true scale and which nothing on the storefront draws once copies exist;
//   - the small copy, 400px, which the product page's option swatches draw and
//     blow up to 200px when a shopper hovers one;
//   - the tiny copy, 128px, which category cards and filter lists draw as dots.
//
// They were one box once, drawing whichever file was lighter, which left no way
// to tell whether a value had copies at all, what any of them weighed, or which
// one the shop was actually putting in front of customers. Three boxes, a ring
// on the ones in use, and the rest of it in the tooltip.
//
// The tooltip is the admin's own (<AdminTooltip>) rather than a native `title`,
// which is the whole point of the row: a native tooltip waits a second before it
// appears, never shows on keyboard focus, and cannot put the file's name in bold
// above what it is for. An empty box gets one too, saying which rendition would
// go there - otherwise the only way to learn what the third box is for is to
// fill it.
export function SwatchRenditions({ attributeId, label, swatch, swatchSmall, swatchTiny, files, disabled, onPick, size = 18 }: {
  attributeId: string
  label: string
  swatch: string | null
  swatchSmall: string | null
  swatchTiny: string | null
  // The screen's url-to-file map. A url missing from it is one the media library
  // has never heard of, which the tooltip says rather than swallowing.
  files: Record<string, SwatchFileInfo>
  disabled?: boolean
  onPick: (url: string) => void | Promise<void>
  size?: number
}) {
  // An IMAGE attribute can hold a value left behind by a spell as a colour
  // attribute, and a hex string handed to an <img src> draws nothing. Every box
  // treats that as "no picture", which is what the picker has always done.
  const picture = swatch && isImageSwatch(swatch) ? swatch : null
  const small = swatchSmall && isImageSwatch(swatchSmall) ? swatchSmall : null
  const tiny = swatchTiny && isImageSwatch(swatchTiny) ? swatchTiny : null
  const { boxes } = describeSwatchRenditions(picture, small, tiny, files)
  const [full, smallBox, tinyBox] = boxes

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      <AdminTooltip title={full.title} body={full.detail}>
        <SwatchImagePicker
          attributeId={attributeId}
          value={picture}
          // Null on purpose, so this box draws the full picture rather than a
          // copy standing in for it. Seeing the renditions apart is the point,
          // and the img is lazy, so nothing off-screen is fetched to do it.
          previewUrl={null}
          label={label}
          disabled={disabled}
          size={size}
          hoverText={`${full.title}. ${full.detail}`}
          highlight={full.inUse}
          nativeTitle={false}
          onPick={onPick}
        />
      </AdminTooltip>
      <CopyBox box={smallBox} size={size} />
      <CopyBox box={tinyBox} size={size} />
    </span>
  )
}

// One shrunk copy's box. Read-only: a copy is made from the full picture, never
// chosen. The way to change it is to change the picture beside it, or to press
// "Make copies" when there is none yet.
function CopyBox({ box, size }: { box: SwatchRenditionBox; size: number }) {
  const shell: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 'var(--radius-md)',
    // Outline rather than a thicker border: at 18px a 2px border would eat most
    // of the picture it is meant to be pointing at.
    outline: box.inUse ? '2px solid var(--color-primary)' : undefined,
    outlineOffset: box.inUse ? 1 : undefined,
  }

  return (
    <AdminTooltip title={box.title} body={box.detail}>
      {box.url ? (
        <span role="img" aria-label={`${box.title}. ${box.detail}`} style={{ ...shell, border: '1px solid var(--color-border)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader */}
          <img src={box.url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </span>
      ) : (
        // An empty dashed box rather than nothing at all: a missing copy is a
        // fact about the value worth a space on the row, and hovering says which
        // copy it would be and whether one is wanted.
        <span
          role="img"
          aria-label={`${box.title}. ${box.detail}`}
          // Focusable so the tooltip is reachable without a mouse. It is the only
          // thing this box has to offer, and an empty one has nothing else.
          tabIndex={0}
          style={{
            ...shell,
            border: '1px dashed var(--color-text-secondary)',
            color: 'var(--color-text-secondary)',
            fontSize: '0.625rem',
            lineHeight: 1,
          }}
        >
          <span aria-hidden>·</span>
        </span>
      )}
    </AdminTooltip>
  )
}
