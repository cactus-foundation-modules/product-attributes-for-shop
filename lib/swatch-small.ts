import sharp from 'sharp'
import { prisma } from '@/lib/db/prisma'
import { downloadMedia, uploadMedia, buildLibraryUploadKey, saveMediaRecord } from '@/lib/media/upload'
import { resolveFolderPath } from '@/lib/media/organise'

// Makes the small rendition behind `swatch_small`: a shrunk webp copy of a
// picture swatch, saved to the media library beside the original.
//
// Why a second FILE rather than resizing the original: the original is load-
// bearing at full size - the 3D module paints it onto models at true scale,
// where a shrunk texture blurs into mush. The storefront meanwhile draws the
// same picture at 28px on the product page and 18px on category cards, so a
// category of fabric-heavy products pulls megabytes to paint a row of dots.
// Two files, two jobs: `swatch` stays the texture, `swatch_small` is the dot.

// The small copy's longest edge. Sized for the biggest thing the storefront
// draws from it - the 200px hover preview on the product page's picker - at a
// 2x display, so it stays sharp everywhere it is actually shown.
export const SMALL_SWATCH_MAX_PX = 400

// Under this weight the original IS the small copy to any useful approximation,
// and a duplicate file would be library clutter for no saved bandwidth.
const WORTHWHILE_BYTES = 100_000

// Formats sharp can be trusted to shrink well here. SVG scales by nature and
// GIF may animate - shrinking either buys little or breaks something, so both
// are left alone and the storefront simply keeps using the original.
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Make (or decline to make) a small rendition of the picture at `swatchUrl`.
 *
 * Returns the new copy's url, or null when there is nothing worth making: the
 * url is not a library item (an external host - there are no bytes to read), the
 * format is not one to shrink, or the original is already small enough that a
 * copy would save nothing. Null is a fine answer - every renderer falls back to
 * the original - so callers store it as they would a real url.
 *
 * Failures are also null, logged rather than thrown: this runs inside value
 * saves and backfills, and losing an admin's edit over a thumbnail would be the
 * tail wagging the dog.
 */
export async function generateSmallSwatch(swatchUrl: string, userId?: string): Promise<string | null> {
  try {
    const media = await prisma.media.findFirst({
      where: { url: swatchUrl },
      select: { id: true, key: true, url: true, provider: true, mimeType: true, sizeBytes: true, folderId: true, uploadedById: true },
    })
    if (!media) return null
    if (!RESIZABLE_TYPES.has(media.mimeType)) return null

    const original = await downloadMedia(media.provider, media.key, media.url)

    // Already small in both pixels and bytes: the original serves the dots as
    // well as a copy would, and the fallback path shows it anyway.
    const meta = await sharp(original).metadata()
    const widest = Math.max(meta.width ?? 0, meta.height ?? 0)
    if (widest <= SMALL_SWATCH_MAX_PX && original.length <= WORTHWHILE_BYTES) return null

    // `rotate()` first so an EXIF-orientated photograph keeps pointing the way
    // it did in the picker rather than lying on its side in the small copy.
    const shrunk = await sharp(original)
      .rotate()
      .resize({ width: SMALL_SWATCH_MAX_PX, height: SMALL_SWATCH_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    // Named after the original with a `-small` tail, filed in the same folder,
    // so the pair reads as a pair in the library. buildLibraryUploadKey dedupes
    // a name collision with the usual "-2" rather than overwriting.
    const baseName = (media.key.split('/').pop() ?? 'swatch').replace(/\.[a-z0-9]+$/i, '')
    const folderPath = await resolveFolderPath(media.folderId)
    const key = await buildLibraryUploadKey(media.provider, 'image/webp', `${baseName}-small.webp`, folderPath || undefined)
    const uploaded = await uploadMedia(shrunk, 'image/webp', media.provider, `${baseName}-small.webp`, folderPath || undefined, false, key)

    const record = await saveMediaRecord({
      key: uploaded.key,
      url: uploaded.url,
      provider: media.provider,
      mimeType: 'image/webp',
      sizeBytes: shrunk.length,
      uploadedById: userId ?? media.uploadedById ?? undefined,
      originalName: `${baseName}-small.webp`,
      folderId: media.folderId,
      // A derived resize of an already-served picture: the optimiser has nothing
      // to add, and the ⚡ button would only re-compress the compression.
      optimised: true,
    })
    return record.url
  } catch (err) {
    console.warn(`[product-attributes-for-shop] could not make a small copy of swatch ${swatchUrl}:`, err)
    return null
  }
}
