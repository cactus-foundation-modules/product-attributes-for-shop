import { prisma } from '@/lib/db/prisma'

// Provider for the core.media-usage-providers extension point.
//
// An attribute value's swatch holds either a colour or the url of a swatch image
// from the media library - a fabric photograph, a finish sample. A shop with a
// full attribute set has hundreds of them, and core could see none of them, so
// the media library counted the lot as unused and reclaimable.
//
// Colour swatches come back too. A hex string matches no media item, so returning
// them costs a few bytes of haystack and saves parsing the column's two meanings
// apart here.
export async function productAttributesMediaUsageProvider(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ ref: string | null }[]>`
    SELECT "swatch" AS ref FROM "pat_attribute_values" WHERE "swatch" IS NOT NULL
  `
  return rows.map((r) => r.ref).filter((r): r is string => !!r)
}
