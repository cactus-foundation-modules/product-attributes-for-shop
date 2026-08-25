import { generateImageRenditions } from '@/lib/media/renditions'
import {
  SWATCH_SMALL_MAX_PX,
  SWATCH_TINY_MAX_PX,
  SWATCH_RENDITION_WORTHWHILE_BYTES,
} from '@/lib/media/swatch-renditions'

// Makes the two shrunk copies behind `swatch_small` and `swatch_tiny`.
//
// The resizing itself is core's (lib/media/renditions.ts) - there is nothing
// attribute-specific about "make me a 128px copy of that", and the filters
// module wants the same thing. What is this module's is the pair of sizes and
// the naming, which is all that is left here.
//
// Why copies rather than resizing the original: the original is load-bearing at
// full size - the 3D module paints it onto models at true scale, where a shrunk
// texture blurs into mush. The product page draws a 200px preview on hovering an
// option, so it wants the 400px copy; a category page draws 18px chips and 14px
// dots, so it wants the 128px one. Three files, three jobs.

export type SwatchCopies = { small: string | null; tiny: string | null }

/**
 * Make (or decline to make) both shrunk copies of the picture at `swatchUrl`.
 *
 * Either may come back null, which is a fine answer - every renderer falls back
 * to the next size up - so callers store what they get. See the core helper for
 * when it declines: an external host, a format not worth shrinking, or a picture
 * already small enough that a copy would save nothing.
 */
export async function generateSwatchCopies(swatchUrl: string, userId?: string): Promise<SwatchCopies> {
  const made = await generateImageRenditions(
    swatchUrl,
    [
      { maxPx: SWATCH_SMALL_MAX_PX, suffix: 'small' },
      { maxPx: SWATCH_TINY_MAX_PX, suffix: 'tiny' },
    ],
    { worthwhileBytes: SWATCH_RENDITION_WORTHWHILE_BYTES, userId },
  )
  return { small: made.small ?? null, tiny: made.tiny ?? null }
}
