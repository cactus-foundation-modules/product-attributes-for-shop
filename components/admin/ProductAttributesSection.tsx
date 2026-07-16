import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { ProductAttributesEditor } from '@/modules/product-attributes-for-shop/components/admin/ProductAttributesEditor'

// The Attributes tab on the shop product editor, contributed through the
// shop.product-editor-sections point. Server component: it only works out
// whether the variations module is about, then hands off to the client editor,
// which loads this product's own assignments and registers them with the
// editor's single Save button.
export async function ProductAttributesSection({ productId }: { productId: string }) {
  const variationsInstalled = await hasVariationsTables()
  return <ProductAttributesEditor productId={productId} variationsInstalled={variationsInstalled} />
}
