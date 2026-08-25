import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateAttributeValue } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { generateSwatchCopies, type SwatchCopyName } from '@/modules/product-attributes-for-shop/lib/swatch-renditions'
import { syncSourcedOptionValues } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'

// Backfill: make the shrunk copies for picture swatches that predate them.
//
// Batched by cursor because each picture is a download, a pair of resizes and
// two uploads - a shop with hundreds of fabric photographs cannot do the lot
// inside one serverless invocation's budget. The screen's button calls this in a
// loop, passing back `lastId` until `remaining` reaches zero. A value whose
// picture yields nothing (an external host, a picture already small) is simply
// passed over; the cursor moves regardless, so the loop always terminates.
//
// Both copies are considered together: a value missing EITHER is a candidate,
// which is what makes this the upgrade path for values that already had a small
// copy from before the tiny one existed.
const Body = z.object({
  limit: z.number().int().min(1).max(25).optional(),
  afterId: z.string().max(200).optional(),
})

// A value wants work when it has a picture that is not a hex colour and is
// missing at least one of its two copies. The hex test is only a coarse SQL
// filter; isImageSwatch remains the real judge. Written out at both call sites
// rather than shared as a string, so both stay parameterised tagged templates.

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const limit = parsed.data.limit ?? 8
  const afterId = parsed.data.afterId ?? ''

  const rows = await prisma.$queryRaw<{ id: string; swatch: string; swatch_small: string | null; swatch_tiny: string | null }[]>`
    SELECT "id", "swatch", "swatch_small", "swatch_tiny" FROM "pat_attribute_values"
    WHERE "swatch" IS NOT NULL AND "swatch" NOT LIKE '#%'
      AND ("swatch_small" IS NULL OR "swatch_tiny" IS NULL)
      AND "id" > ${afterId}
    ORDER BY "id" ASC
    LIMIT ${limit}
  `

  let made = 0
  let skipped = 0
  // Several values routinely share one picture - a fabric offered under Colour
  // and again under Upholstery - so what has been worked out for a url is reused
  // across the batch rather than worked out per value.
  const copiesByUrl = new Map<string, { small: string | null; tiny: string | null }>()
  for (const row of rows) {
    if (!isImageSwatch(row.swatch)) { skipped += 1; continue }

    // What any value already has for this picture, taken column by column rather
    // than from whichever row turned up first. Reading one row was the bug: on a
    // shop whose swatches had a small copy from an earlier version and no tiny,
    // every sibling reported "has something", the tiny was minted again for each
    // one, and the small was re-made and thrown away with it.
    const known = copiesByUrl.get(row.swatch) ?? await (async () => {
      const sibling = await prisma.$queryRaw<[{ small: string | null; tiny: string | null }]>`
        SELECT MAX("swatch_small") AS small, MAX("swatch_tiny") AS tiny
        FROM "pat_attribute_values" WHERE "swatch" = ${row.swatch}
      `
      return { small: sibling[0]?.small ?? null, tiny: sibling[0]?.tiny ?? null }
    })()

    let small = row.swatch_small ?? known.small
    let tiny = row.swatch_tiny ?? known.tiny
    const want: SwatchCopyName[] = [...(small ? [] : ['small' as const]), ...(tiny ? [] : ['tiny' as const])]
    if (want.length > 0) {
      const fresh = await generateSwatchCopies(row.swatch, { want })
      small = small ?? fresh.small
      tiny = tiny ?? fresh.tiny
    }
    copiesByUrl.set(row.swatch, { small, tiny })

    if (small === row.swatch_small && tiny === row.swatch_tiny) { skipped += 1; continue }
    await updateAttributeValue(row.id, { swatchSmall: small, swatchTiny: tiny })
    // The variation copies are what the storefront actually reads, so each
    // freshly-made rendition goes straight out to them.
    await syncSourcedOptionValues(row.id, { swatchSmall: small, swatchTiny: tiny })
    made += 1
  }

  const lastId = rows[rows.length - 1]?.id ?? afterId
  const remainingRows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS "count" FROM "pat_attribute_values"
    WHERE "swatch" IS NOT NULL AND "swatch" NOT LIKE '#%'
      AND ("swatch_small" IS NULL OR "swatch_tiny" IS NULL)
      AND "id" > ${lastId}
  `
  const remaining = Number(remainingRows[0]?.count ?? 0)

  return NextResponse.json({ made, skipped, lastId, remaining, done: rows.length === 0 || remaining === 0 })
}
