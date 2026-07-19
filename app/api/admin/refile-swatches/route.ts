import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { refileAttributeSwatches } from '@/modules/product-attributes-for-shop/lib/media-folder'

// Walk every attribute and file its picture swatches where they belong: the
// shop-wide attributes folder (shop / attributes / [group] / <attribute>), not
// whichever product folder they happened to land in. Idempotent - a picture
// already in the right place is left alone - so pressing it twice is harmless.
//
// Exists because earlier versions of shop-variations dragged a sourced swatch's
// picture into the product's own colours folder when an option was built from an
// attribute. That leak is fixed at source, but pictures it already misfiled stay
// misfiled until something moves them back; this is that something. The refile
// also repoints every variation option copy of the moved url (see
// fileSwatchImage in lib/media-folder.ts), so nothing is left serving a dead one.
export async function POST() {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const attributes = await listAttributes()
  for (const attribute of attributes) {
    await refileAttributeSwatches(attribute.id)
  }
  return NextResponse.json({ attributes: attributes.length })
}
