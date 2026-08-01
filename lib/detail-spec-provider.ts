import { SpecificationPanel } from '@/modules/product-attributes-for-shop/components/public/SpecificationPanel'
import { getProductSpecView, type PatSpecPanelPayload } from '@/modules/product-attributes-for-shop/lib/db/spec-view'
import { getShopBreakpoints } from '@/modules/shop/lib/breakpoints'
import type { ShopDetailSpecProvider } from '@/modules/shop/lib/detail-spec'

// This module's answer to shop's `shop.product-detail-spec` point: it takes over
// the Specification tab's body for a product that has attributes flagged for the
// page, swapping shop's own facts table for the owner's headed attribute groups.
//
// Null when the product has none, which is what keeps shop's own SKU/Type/Weight/
// Dimensions facts in place on the many products that show no attributes there -
// installing this module changes a product's Specification only once an attribute
// is actually flagged for it.
//
// The site's own breakpoints ride along with the view: the panel's group grid
// drops from three columns to two to one at them, and a media query cannot read
// a CSS custom property, so they have to be resolved server-side and baked into
// the panel's <style>.
export const productAttributesSpecProvider: ShopDetailSpecProvider = {
  load: async (productId: string): Promise<PatSpecPanelPayload | null> => {
    const view = await getProductSpecView(productId)
    if (!view) return null
    return { ...view, breakpoints: await getShopBreakpoints() }
  },
  Panel: SpecificationPanel,
}
