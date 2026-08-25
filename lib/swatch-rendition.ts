import {
  SMALL_SWATCH_MAX_PX,
  SMALL_SWATCH_WORTHWHILE_BYTES,
  type PatSwatchFileInfo,
} from '@/modules/product-attributes-for-shop/lib/types'

// A picture swatch is kept twice: the full picture, which stays at true size
// because the 3D module paints it onto models and the product page blows it up
// on hover, and a small copy, which is what a storefront option swatch actually
// draws. The admin screen shows both, and the only way anybody can tell them
// apart at 18px is by what it says on hovering, so the wording is worked out
// here rather than inline: it is the whole of the feature, and it is testable.
//
// Client-safe on purpose. Nothing in here imports the resizer, which would drag
// sharp into the browser bundle; the two thresholds live in lib/types.ts so both
// sides read the same numbers.

export type SwatchRenditionVerdict =
  // No picture on the value at all.
  | 'no-picture'
  // A small copy exists, so that is what option swatches draw.
  | 'has-small'
  // No small copy, and none is wanted: the full picture is under both caps.
  | 'small-enough'
  // No small copy; the full picture is light but has never been measured, so
  // whether a copy would be made cannot be promised either way.
  | 'maybe-small-enough'
  // No small copy and the full picture is over a cap, so one is worth making.
  | 'wants-small'
  // The picture is not a library item, so there are no bytes to shrink.
  | 'not-in-library'

export type SwatchRenditionNotes = {
  verdict: SwatchRenditionVerdict
  // Which of the two pictures the storefront draws on an option swatch. Every
  // renderer falls back to the full picture when there is no small copy, so this
  // is 'small' only when a small copy actually exists.
  usedForOptions: 'full' | 'small'
  // Hover text for each box. Also its accessible name, so the two are never told
  // different stories.
  full: string
  small: string
}

// KB and MB rather than kB and MiB: this is a figure an owner compares against
// what their phone says a photo weighs, not a specification.
export function formatSwatchFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// "312 KB, 2000 x 2000" where the library has measured it, weight alone where it
// has not, and an honest shrug where it has never seen the file.
export function describeSwatchFile(info: PatSwatchFileInfo | undefined): string {
  if (!info) return 'size unknown, not in the media library'
  const size = formatSwatchFileSize(info.bytes)
  if (info.width && info.height) return `${size}, ${info.width} x ${info.height}`
  return size
}

function judge(swatch: string | null, swatchSmall: string | null, info: PatSwatchFileInfo | undefined): SwatchRenditionVerdict {
  if (!swatch) return 'no-picture'
  if (swatchSmall) return 'has-small'
  if (!info) return 'not-in-library'
  const light = info.bytes <= SMALL_SWATCH_WORTHWHILE_BYTES
  const measured = info.width !== null && info.height !== null
  if (!measured) return light ? 'maybe-small-enough' : 'wants-small'
  const small = (info.width ?? 0) <= SMALL_SWATCH_MAX_PX && (info.height ?? 0) <= SMALL_SWATCH_MAX_PX
  return light && small ? 'small-enough' : 'wants-small'
}

/**
 * What to say about one value's pair of pictures.
 *
 * `files` is the whole screen's url-to-file map; a url missing from it is one the
 * media library has never heard of, which is a fact worth telling the owner
 * rather than a blank.
 */
export function describeSwatchRenditions(
  swatch: string | null,
  swatchSmall: string | null,
  files: Record<string, PatSwatchFileInfo>,
): SwatchRenditionNotes {
  const fullInfo = swatch ? files[swatch] : undefined
  const smallInfo = swatchSmall ? files[swatchSmall] : undefined
  const verdict = judge(swatch, swatchSmall, fullInfo)
  const fullFacts = describeSwatchFile(fullInfo)
  const pick = 'Click to change it, or drop an image here.'

  if (verdict === 'no-picture') {
    return {
      verdict,
      usedForOptions: 'full',
      full: 'No picture yet. Click to choose one from the library, or drop an image here.',
      small: 'No small copy: there is no picture to shrink yet.',
    }
  }

  if (verdict === 'has-small') {
    return {
      verdict,
      usedForOptions: 'small',
      full: `Full picture: ${fullFacts}. Not what product option swatches draw - the small copy is. This one stays full size for 3D models and the big hover preview. ${pick}`,
      small: `Small copy: ${describeSwatchFile(smallInfo)}. This is what product option swatches draw.`,
    }
  }

  const tail: Record<Exclude<SwatchRenditionVerdict, 'no-picture' | 'has-small'>, { full: string; small: string }> = {
    'small-enough': {
      full: `Used for product option swatches. Already small enough that a second copy would save nothing.`,
      small: `No small copy: the full picture (${fullFacts}) is already small enough, so product option swatches draw that instead.`,
    },
    'maybe-small-enough': {
      full: `Used for product option swatches. Light enough that a small copy may not be worth making, though nobody has measured its dimensions.`,
      small: `No small copy. The full picture is only ${fullFacts}, so making one may save nothing; product option swatches draw the full picture meanwhile.`,
    },
    'wants-small': {
      full: `Used for product option swatches, because it has no small copy yet. Press "Make small copies" above to give it one.`,
      small: `No small copy yet, so product option swatches draw the full picture (${fullFacts}). Press "Make small copies" above to make one.`,
    },
    'not-in-library': {
      full: `Used for product option swatches. Not a media library picture, so there is nothing here to shrink.`,
      small: `No small copy: this picture is not in the media library, so there is nothing to shrink. Product option swatches draw the full picture.`,
    },
  }

  return {
    verdict,
    usedForOptions: 'full',
    full: `Full picture: ${fullFacts}. ${tail[verdict].full} ${pick}`,
    small: tail[verdict].small,
  }
}
