import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { findAttributeFolderId, resolveAttributeFolderId } from '@/modules/product-attributes-for-shop/lib/media-folder'

// Where the picture picker should open (GET) and where a dropped file should be
// uploaded (POST) for this attribute's image swatches.
//
// Two verbs because the two answers differ on purpose: browsing must not create
// anything, so merely opening the picker on a fresh attribute leaves no empty
// folder behind, while an actual upload does need the folder to exist. Same
// split, same reasoning, as shop's own products/[id]/media-folder.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json({ folderId: await findAttributeFolderId(id) })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json({ folderId: await resolveAttributeFolderId(id) })
}
