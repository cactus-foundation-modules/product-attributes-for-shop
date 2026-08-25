import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateAttributeValue } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { generateSwatchCopies } from '@/modules/product-attributes-for-shop/lib/swatch-renditions'
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
  // Two values often share one picture (a colour reused across attributes), so
  // copies already made for the same url - this batch or an earlier one - are
  // reused rather than minted again.
  const madeByUrl = new Map<string, { small: string | null; tiny: string | null }>()
  for (const row of rows) {
    if (!isImageSwatch(row.swatch)) { skipped += 1; continue }

    let copies = madeByUrl.get(row.swatch) ?? null
    if (!copies) {
      const sibling = await prisma.$queryRaw<{ swatch_small: string | null; swatch_tiny: string | null }[]>`
        SELECT "swatch_small", "swatch_tiny" FROM "pat_attribute_values"
        WHERE "swatch" = ${row.swatch} AND ("swatch_small" IS NOT NULL OR "swatch_tiny" IS NOT NULL)
        LIMIT 1
      `
      const found = sibling[0]
      // A sibling only helps for the copies it actually has; anything still
      // missing is minted below and shared onwards through madeByUrl.
      if (found && found.swatch_small && found.swatch_tiny) {
        copies = { small: found.swatch_small, tiny: found.swatch_tiny }
      } else {
        const fresh = await generateSwatchCopies(row.swatch)
        copies = {
          small: found?.swatch_small ?? fresh.small,
          tiny: found?.swatch_tiny ?? fresh.tiny,
        }
      }
    }

    const nextSmall = row.swatch_small ?? copies.small
    const nextTiny = row.swatch_tiny ?? copies.tiny
    if (nextSmall === row.swatch_small && nextTiny === row.swatch_tiny) { skipped += 1; continue }

    madeByUrl.set(row.swatch, copies)
    await updateAttributeValue(row.id, { swatchSmall: nextSmall, swatchTiny: nextTiny })
    // The variation copies are what the storefront actually reads, so each
    // freshly-made rendition goes straight out to them.
    await syncSourcedOptionValues(row.id, { swatchSmall: nextSmall, swatchTiny: nextTiny })
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
