import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSettings, updateSettings } from '@/modules/product-attributes-for-shop/lib/db/settings'

const Body = z.object({
  hideEmptyValues: z.boolean().optional(),
  includeVariantValues: z.boolean().optional(),
})

export async function GET() {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  return NextResponse.json({ settings: await getSettings() })
}

export async function PUT(request: NextRequest) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })

  await updateSettings(parsed.data)
  return NextResponse.json({ settings: await getSettings() })
}
