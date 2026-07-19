import { prisma } from '@/lib/db/prisma'
import { getOrCreateFolderByPath, cleanFolderName, sanitizeFolderSegment, moveOrRenameMedia } from '@/lib/media/organise'
import { getAttribute, listAttributeSwatches, updateAttributeValue } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { getAttributeGroup, listAttributeIdsInGroup } from '@/modules/product-attributes-for-shop/lib/db/groups'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { syncSourcedOptionValues } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

/**
 * Where an image-swatch's pictures belong in the library: shop / attributes /
 * [group name /] <attribute name>.
 *
 * The group segment is present only when the attribute sits in one, so an
 * ungrouped attribute's folder is exactly what it was before groups existed and
 * nothing has to be shuffled on upgrade. Putting an attribute into a group, or
 * renaming that group, does move its pictures - see refileAttributeSwatches,
 * which every caller that changes either must run.
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
export function attributeFolderSegments(attributeName: string, groupName?: string | null): string[] {
  return [
    sanitizeFolderSegment('Shop'),
    sanitizeFolderSegment('Attributes'),
    ...(groupName ? [sanitizeFolderSegment(groupName)] : []),
    sanitizeFolderSegment(attributeName),
  ]
}

// The folder path for one attribute as it stands right now, group included.
async function segmentsForAttribute(attributeId: string): Promise<string[] | null> {
  const attribute = await getAttribute(attributeId)
  if (!attribute) return null
  const group = attribute.groupId ? await getAttributeGroup(attribute.groupId) : null
  return attributeFolderSegments(attribute.name, group?.name ?? null)
}

export async function resolveAttributeFolderId(attributeId: string): Promise<string | null> {
  const segments = await segmentsForAttribute(attributeId)
  if (!segments) return null
  return getOrCreateFolderByPath(segments)
}

/**
 * The same walk, looking only - nothing is created. An attribute whose picker
 * has merely been opened should land on the nearest folder that already exists
 * (its own, else Attributes, else Shop, else the root) rather than conjure an
 * empty folder per attribute. Mirrors shop's findProductMediaFolderId.
 */
export async function findAttributeFolderId(attributeId: string): Promise<string | null> {
  const segments = await segmentsForAttribute(attributeId)
  if (!segments) return null

  let parentId: string | null = null
  for (const raw of segments) {
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
      // Variation options built from this value hold their own copy of the url,
      // so a move that rewrites it has to land there too - otherwise every
      // product option copied from this attribute keeps serving the old url.
      await syncSourcedOptionValues(valueId, { swatch: updated.url })
    }
  } catch (err) {
    // A picture failing to file (provider hiccup, missing blob) must not fail the
    // save - the value keeps its current url and can be re-filed next time.
    console.warn(`[product-attributes-for-shop] could not file swatch image ${swatchUrl} for attribute ${attributeId}:`, err)
  }
}

/**
 * Move every picture swatch an attribute already has into wherever the attribute
 * now belongs, and repoint the stored urls at the moved files.
 *
 * Run after anything that changes the folder path: putting the attribute into a
 * group, taking it back out, moving it between groups, renaming the attribute,
 * renaming or deleting the group. Without this, a "Picture swatches" attribute
 * moved into a folder keeps its pictures behind in the old one - the tidying up
 * that prompted the move would have been half done, and the library would grow a
 * stranded folder per move.
 *
 * Values whose swatch is a hex colour, or a url the library does not own, are
 * skipped by fileSwatchImage. Failures there are already swallowed one picture at
 * a time, so a single unmovable file cannot strand the rest.
 */
export async function refileAttributeSwatches(attributeId: string): Promise<void> {
  const values = await listAttributeSwatches(attributeId)
  for (const value of values) {
    if (!isImageSwatch(value.swatch)) continue
    await fileSwatchImage(attributeId, value.id, value.swatch)
  }
}

// The same, for every attribute in a group - the group's name is a segment of
// all their paths, so renaming or deleting it moves the lot. The attribute ids
// are read before the caller's change lands on `group_id`, or after it in the
// rename case; either way the caller passes what it means to move.
export async function refileGroupSwatches(groupId: string): Promise<void> {
  const attributeIds = await listAttributeIdsInGroup(groupId)
  for (const attributeId of attributeIds) {
    await refileAttributeSwatches(attributeId)
  }
}
