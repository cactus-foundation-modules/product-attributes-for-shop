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

/** Which copies a caller wants made. Both, unless it already has one. */
export type SwatchCopyName = 'small' | 'tiny'

const SIZES: Record<SwatchCopyName, number> = {
  small: SWATCH_SMALL_MAX_PX,
  tiny: SWATCH_TINY_MAX_PX,
}

/**
 * Make (or decline to make) shrunk copies of the picture at `swatchUrl`.
 *
 * `want` narrows it to the copies that are actually missing, which spares the
 * download and the encode for one the value already has - the ordinary case for
 * a shop whose swatches got their small copy under an earlier version. The rest
 * come back null, which callers read as "leave what you had".
 *
 * Either may come back null anyway - an external host, a format not worth
 * shrinking, a picture already small enough - and that is a fine answer, since
 * every renderer falls back to the next size up.
 */
export async function generateSwatchCopies(
  swatchUrl: string,
  opts?: { want?: SwatchCopyName[]; userId?: string },
): Promise<SwatchCopies> {
  const want = opts?.want ?? (['small', 'tiny'] as SwatchCopyName[])
  if (want.length === 0) return { small: null, tiny: null }
  const made = await generateImageRenditions(
    swatchUrl,
    want.map((name) => ({ maxPx: SIZES[name], suffix: name })),
    { worthwhileBytes: SWATCH_RENDITION_WORTHWHILE_BYTES, userId: opts?.userId },
  )
  return { small: made.small ?? null, tiny: made.tiny ?? null }
}
