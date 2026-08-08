import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateAttributeValue } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { generateSmallSwatch } from '@/modules/product-attributes-for-shop/lib/swatch-small'
import { syncSourcedOptionValues } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'

// Backfill: make small renditions for picture swatches that predate them.
//
// Batched by cursor because each picture is a download, a resize and an upload -
// a shop with hundreds of fabric photographs cannot do the lot inside one
// serverless invocation's budget. The screen's button calls this in a loop,
// passing back `lastId` until `remaining` reaches zero. A value whose picture
// yields nothing (an external host, a picture already small) is simply passed
// over; the cursor moves regardless, so the loop always terminates.
const Body = z.object({
  limit: z.number().int().min(1).max(25).optional(),
  afterId: z.string().max(200).optional(),
})

export async function POST(request: Request) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const limit = parsed.data.limit ?? 8
  const afterId = parsed.data.afterId ?? ''

  // Candidates: values with a non-colour swatch and no small yet. The hex test
  // here is only a coarse SQL filter; isImageSwatch remains the real judge.
  const rows = await prisma.$queryRaw<{ id: string; swatch: string }[]>`
    SELECT "id", "swatch" FROM "pat_attribute_values"
    WHERE "swatch" IS NOT NULL AND "swatch" NOT LIKE '#%' AND "swatch_small" IS NULL AND "id" > ${afterId}
    ORDER BY "id" ASC
    LIMIT ${limit}
  `

  let made = 0
  let skipped = 0
  // Two values often share one picture (a colour reused across attributes), so
  // a small already made for the same url - this batch or an earlier one - is
  // reused rather than minted again.
  const madeByUrl = new Map<string, string>()
  for (const row of rows) {
    if (!isImageSwatch(row.swatch)) { skipped += 1; continue }

    let small = madeByUrl.get(row.swatch) ?? null
    if (!small) {
      const sibling = await prisma.$queryRaw<{ swatch_small: string }[]>`
        SELECT "swatch_small" FROM "pat_attribute_values"
        WHERE "swatch" = ${row.swatch} AND "swatch_small" IS NOT NULL
        LIMIT 1
      `
      small = sibling[0]?.swatch_small ?? null
    }
    if (!small) small = await generateSmallSwatch(row.swatch)

    if (!small) { skipped += 1; continue }
    madeByUrl.set(row.swatch, small)
    await updateAttributeValue(row.id, { swatchSmall: small })
    // The variation copies are what the storefront actually reads, so each
    // freshly-made small goes straight out to them.
    await syncSourcedOptionValues(row.id, { swatchSmall: small })
    made += 1
  }

  const lastId = rows[rows.length - 1]?.id ?? afterId
  const remainingRows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS "count" FROM "pat_attribute_values"
    WHERE "swatch" IS NOT NULL AND "swatch" NOT LIKE '#%' AND "swatch_small" IS NULL AND "id" > ${lastId}
  `
  const remaining = Number(remainingRows[0]?.count ?? 0)

  return NextResponse.json({ made, skipped, lastId, remaining, done: rows.length === 0 || remaining === 0 })
}
