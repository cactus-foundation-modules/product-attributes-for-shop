import { prisma } from '@/lib/db/prisma'
import { getOrCreateFolderByPath, cleanFolderName, sanitizeFolderSegment, moveOrRenameMedia } from '@/lib/media/organise'
import { getAttribute, updateAttributeValue } from '@/modules/product-attributes-for-shop/lib/db/attributes'

/**
 * Where an image-swatch's pictures belong in the library: shop / attributes /
 * <attribute name>.
 *
 * Deliberately NOT a product folder, which is where shop-variations, the 3D
 * module and the downloads module all file theirs. Their media belongs to one
 * product; an attribute value here is shop-wide vocabulary - the same "Oak"
 * picture serves every product that carries it - so filing it under whichever
 * product happened to be open when it was uploaded would be actively
 * misleading, and would strand the picture the day that product is deleted.
 *
 * Segments are lower-cased through sanitizeFolderSegment for the same reason
 * shop does it: the storage path is lower-case, and a capitalised tree here
 * would sit alongside the real one rather than in it.
 */
export function attributeFolderSegments(attributeName: string): string[] {
  return [sanitizeFolderSegment('Shop'), sanitizeFolderSegment('Attributes'), sanitizeFolderSegment(attributeName)]
}

export async function resolveAttributeFolderId(attributeId: string): Promise<string | null> {
  const attribute = await getAttribute(attributeId)
  if (!attribute) return null
  return getOrCreateFolderByPath(attributeFolderSegments(attribute.name))
}

/**
 * The same walk, looking only - nothing is created. An attribute whose picker
 * has merely been opened should land on the nearest folder that already exists
 * (its own, else Attributes, else Shop, else the root) rather than conjure an
 * empty folder per attribute. Mirrors shop's findProductMediaFolderId.
 */
export async function findAttributeFolderId(attributeId: string): Promise<string | null> {
  const attribute = await getAttribute(attributeId)
  if (!attribute) return null

  let parentId: string | null = null
  for (const raw of attributeFolderSegments(attribute.name)) {
    const clean = cleanFolderName(raw)
    if (!clean) continue
    const existing: { id: string } | null = await prisma.folder.findFirst({
      where: { parentId, name: clean },
      select: { id: true },
    })
    if (!existing) break
    parentId = existing.id
  }
  return parentId
}

/**
 * File the picture behind an image-swatch value in its attribute's folder,
 * keeping the stored swatch url pointing at it after the move.
 *
 * A no-op unless the swatch is a managed core Media row: a hex colour, or a url
 * hosted somewhere outside the library, has nothing to move - so the Media
 * lookup comes first and the folder is never created for an attribute that only
 * uses colours. Moving may rewrite the url (the library keys blobs by folder),
 * so the value's `swatch` is updated to match.
 */
export async function fileSwatchImage(attributeId: string, valueId: string, swatchUrl: string): Promise<void> {
  const media = await prisma.media.findFirst({ where: { url: swatchUrl }, select: { id: true } })
  if (!media) return

  const folderId = await resolveAttributeFolderId(attributeId)
  if (folderId === null) return

  try {
    // 'suffix' rather than 'replace': two values pointing at pictures that happen
    // to share a filename must not clobber each other in the folder.
    const updated = await moveOrRenameMedia(media.id, { targetFolderId: folderId, collision: 'suffix' })
    if (updated && updated.url !== swatchUrl) {
      await updateAttributeValue(valueId, { swatch: updated.url })
    }
  } catch (err) {
    // A picture failing to file (provider hiccup, missing blob) must not fail the
    // save - the value keeps its current url and can be re-filed next time.
    console.warn(`[product-attributes-for-shop] could not file swatch image ${swatchUrl} for attribute ${attributeId}:`, err)
  }
}
