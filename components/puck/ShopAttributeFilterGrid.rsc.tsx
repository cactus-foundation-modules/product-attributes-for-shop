import { connection } from 'next/server'
import { Render } from '@puckeditor/core/rsc'
import type { Data } from '@puckeditor/core'
import { listProducts, getProductMedia, getProductTagIds } from '@/modules/shop/lib/db'
import { listTags, resolveCategoryProductFilter } from '@/modules/shop/lib/db/catalogue'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { getShopBreakpoints } from '@/modules/shop/lib/breakpoints'
import { resolveCardTemplate, buildCardContext } from '@/modules/shop/lib/card-template'
import { injectShopProductCardEmbed } from '@/modules/shop/lib/inject-part-context'
import { formatMoney } from '@/modules/shop/lib/money'
import { shopCardCss } from '@/modules/shop/components/puck/parts/card-parts'
import type { PuckData } from '@/modules/shop/lib/types'
import type { CardItem } from '@/modules/shop/lib/card-template'
import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { getEffectiveValueIdsByProduct, countProductsByValue } from '@/modules/product-attributes-for-shop/lib/db/assignments'
import { getSettings } from '@/modules/product-attributes-for-shop/lib/db/settings'
import { AttributeFilterShell } from '@/modules/product-attributes-for-shop/components/public/AttributeFilterShell'
import { attributeFilterCss } from '@/modules/product-attributes-for-shop/components/public/filter-css'
import { shopAttributeFilterGridPuckComponent, type ShopAttributeFilterGridProps } from './ShopAttributeFilterGrid'

// Server (RSC) half of Shop: Filtered Product Grid.
//
// Every matching product is rendered up front with the shop's own Product Card
// layout, then the client shell shows and hides them as filters are ticked. That
// keeps the cards pixel-identical to every other shop grid and makes filtering
// instant, at the cost of rendering the whole (capped) result set once. Suits
// the catalogue sizes this platform is aimed at; a shop with thousands of
// products wants a paginated, server-filtered grid instead.
//
// The card anchor below deliberately mirrors shop's own renderCards rather than
// calling it: the only difference is the data-pat-product tag the shell filters
// on, and shop's helper has nowhere to hang it. Template resolution, context
// building and the injected embed all still come from shop, so a change to the
// card design lands here too.

async function renderTaggedCards(template: PuckData | null, items: CardItem[], matrix: Map<string, string[]>) {
  const { getModuleLayoutPuckRscConfig } = await import('@/lib/puck/config.rsc')
  const config = getModuleLayoutPuckRscConfig('shopProductCard')
  return items.map(({ product, ctx }) => (
    <a
      key={product.id}
      href={`/shop/products/${product.slug}`}
      className="shop-card"
      data-pat-product={product.id}
      data-pat-values={(matrix.get(product.id) ?? []).join(' ')}
    >
      {template ? (
        <Render config={config as any} data={injectShopProductCardEmbed(template, ctx) as Data} />
      ) : (
        <>
          <div className="shop-card-img">
            {ctx.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ctx.image.url} alt={ctx.image.alt} />
            )}
          </div>
          <h3 className="shop-card-name">{product.name}</h3>
          <div className="shop-card-pricerow">
            <span className="shop-card-price">{formatMoney(product.price, ctx.currencySymbol)}</span>
          </div>
        </>
      )}
    </a>
  ))
}

export async function ShopAttributeFilterGridRsc(props: ShopAttributeFilterGridProps) {
  await connection()
  const columns = props.columns ?? 3
  const config = await getShopConfigCached()
  const categoryFilter = props.categorySlug
    ? await resolveCategoryProductFilter(props.categorySlug, config.categoryProductDisplayMode)
    : {}

  const [bp, tags, listed, template, attributes, settings] = await Promise.all([
    getShopBreakpoints(),
    listTags(),
    listProducts({
      status: 'ACTIVE',
      ...categoryFilter,
      collectionSlug: props.collectionSlug || undefined,
      tagSlug: props.tagSlug || undefined,
      // listProducts clamps perPage to 100. Filtering happens over exactly what
      // is rendered, so the cap is the honest ceiling of this block.
      perPage: props.limit ?? 24,
      excludeHidden: true,
    }),
    resolveCardTemplate(props.layoutRef),
    listAttributes({ filtersOnly: true }),
    getSettings(),
  ])

  const { products } = listed
  if (products.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No products to show yet.</p>
  }

  const productIds = products.map((p) => p.id)
  const [matrix, counts] = await Promise.all([
    getEffectiveValueIdsByProduct(productIds, { includeVariantValues: settings.includeVariantValues }),
    countProductsByValue(productIds),
  ])

  const tagById = new Map(tags.map((t) => [t.id, t.slug]))
  const items: CardItem[] = await Promise.all(
    products.map(async (product) => {
      const [media, tagIds] = await Promise.all([getProductMedia(product.id), getProductTagIds(product.id)])
      return { product, ctx: buildCardContext(product, media, tagById, tagIds, config.currencySymbol) }
    }),
  )

  const cards = await renderTaggedCards(template, items, matrix)

  // Drop filter options nothing on this page can match, so a category page never
  // offers a tick that always returns nothing.
  const offered = settings.hideEmptyValues
    ? attributes
        .map((a) => ({ ...a, values: a.values.filter((v) => (counts.get(v.id) ?? 0) > 0) }))
        .filter((a) => a.values.length > 0)
    : attributes

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: shopCardCss(bp) + attributeFilterCss(bp) }} />
      <AttributeFilterShell
        attributes={offered}
        matrix={Object.fromEntries(matrix)}
        counts={Object.fromEntries(counts)}
        columns={columns}
        position={props.filterPosition === 'top' ? 'top' : 'left'}
        showCounts={props.showCounts !== 'no'}
      >
        {cards}
      </AttributeFilterShell>
    </>
  )
}

export const shopAttributeFilterGridPuckRscComponent = {
  ...shopAttributeFilterGridPuckComponent,
  render: ShopAttributeFilterGridRsc,
}
