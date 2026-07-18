import { prisma } from '@/lib/db/prisma'
import type { MediaReferenceChange } from '@/lib/media/reference-rewriters'

// Provider for the core.media-reference-rewriters extension point.
//
// An IMAGE-type attribute value keeps its picture's public url in
// pat_attribute_values.swatch (the same column holds a hex colour for a SWATCH
// attribute). The admin stores the picker's Media.url in it verbatim. When core
// moves a blob - optimise to WebP, resize, crop, replace, rename - the item's
// url changes but the column still names the old, now-deleted blob, so the tile
// 404s while the library looks perfectly healthy. Repoint it onto the new url.
//
// Equality, not substring: for an image swatch the column IS the whole url, so
// `= oldUrl` cannot match a hex colour or an unrelated row.
export async function productAttributesMediaReferenceRewriter(change: MediaReferenceChange): Promise<void> {
  const { oldUrl, newUrl } = change
  if (!oldUrl || oldUrl === newUrl) return

  await prisma.$executeRaw`
    UPDATE "pat_attribute_values" SET "swatch" = ${newUrl} WHERE "swatch" = ${oldUrl}
  `
}
