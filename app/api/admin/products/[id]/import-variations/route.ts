import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { importVariationOptions } from '@/modules/product-attributes-for-shop/lib/import-service'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  if (!(await hasVariationsTables())) {
    return NextResponse.json({ error: 'The Shop Variations module is not installed.' }, { status: 409 })
  }

  const result = await importVariationOptions(id)
  if (result.optionNames.length === 0) {
    return NextResponse.json({ error: 'This product has no variation options to import.' }, { status: 409 })
  }
  return NextResponse.json(result)
}
